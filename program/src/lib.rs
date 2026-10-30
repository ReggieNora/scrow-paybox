use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("SCrow11111111111111111111111111111111111111");

/// Protocol fee in basis points: 0.75% = 75 bps out of 10,000
pub const PROTOCOL_FEE_BPS: u64 = 75;
pub const BPS_DENOMINATOR: u64 = 10_000;
pub const MAX_REVISION_ATTEMPTS: u8 = 3;
pub const MAX_SUBMISSION_URL_LEN: usize = 256;

#[program]
pub mod scrow {
    use super::*;

    /// 1. `initialize_escrow`: Creates an ephemeral PDA holding locked SOL
    /// and initializes deterministic 3-strike revision tracking.
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        amount: u64,
        terms_hash: [u8; 32],
        deadline: Option<i64>,
    ) -> Result<()> {
        require!(amount > 0, ScrowError::InvalidAmount);

        // Transfer locked funds from creator into the ephemeral Escrow PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        );
        transfer(cpi_context, amount)?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.creator = ctx.accounts.creator.key();
        escrow.recipient = ctx.accounts.recipient.key();
        escrow.protocol_treasury = ctx.accounts.protocol_treasury.key();
        escrow.amount = amount;
        escrow.attempts_used = 0;
        escrow.terms_hash = terms_hash;
        escrow.deadline = deadline;
        escrow.escrow_state = EscrowState::Pending;
        escrow.submission_url = String::new();
        escrow.bump = ctx.bumps.escrow;

        emit!(EscrowInitialized {
            escrow: escrow.key(),
            creator: escrow.creator,
            recipient: escrow.recipient,
            amount,
            terms_hash,
        });

        Ok(())
    }

    /// 2. `submit_work`: Recipient attaches submission proof metadata URL (e.g., GitHub PR / IPFS URI)
    /// and advances the escrow state to `InReview`.
    pub fn submit_work(ctx: Context<SubmitWork>, submission_url: String) -> Result<()> {
        require!(
            !submission_url.trim().is_empty() && submission_url.len() <= MAX_SUBMISSION_URL_LEN,
            ScrowError::InvalidSubmissionUrl
        );

        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.escrow_state == EscrowState::Pending,
            ScrowError::InvalidEscrowState
        );
        require!(
            escrow.attempts_used < MAX_REVISION_ATTEMPTS,
            ScrowError::MaxAttemptsReached
        );

        escrow.submission_url = submission_url.clone();
        escrow.escrow_state = EscrowState::InReview;

        emit!(WorkSubmitted {
            escrow: escrow.key(),
            recipient: escrow.recipient,
            submission_url,
            attempts_used: escrow.attempts_used,
        });

        Ok(())
    }

    /// 3. `review_work`: Creator either approves the submission or requests a revision.
    /// - Revision Action (`approved == false`): Increments `attempts_used`.
    ///   If `attempts_used == 3`, automatically transitions state to `Refunded` and refunds locked principal to creator.
    ///   Otherwise returns state to `Pending` for the next submission attempt.
    /// - Approval Action (`approved == true`): Marks work approved and triggers payout settlement
    ///   (or enables immediate `release_payout`).
    pub fn review_work(ctx: Context<ReviewWork>, approved: bool) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.escrow_state == EscrowState::InReview,
            ScrowError::InvalidEscrowState
        );

        if approved {
            // Execute 0.75% protocol fee deduction and 99.25% payout to recipient
            let total_amount = escrow.amount;
            let protocol_fee = total_amount
                .checked_mul(PROTOCOL_FEE_BPS)
                .ok_or(ScrowError::MathOverflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(ScrowError::MathOverflow)?;
            let recipient_payout = total_amount
                .checked_sub(protocol_fee)
                .ok_or(ScrowError::MathOverflow)?;

            escrow.escrow_state = EscrowState::Released;
            escrow.amount = 0;

            let escrow_info = escrow.to_account_info();
            let treasury_info = ctx.accounts.protocol_treasury.to_account_info();
            let recipient_info = ctx.accounts.recipient.to_account_info();

            if protocol_fee > 0 {
                **escrow_info.try_borrow_mut_lamports()? = escrow_info
                    .lamports()
                    .checked_sub(protocol_fee)
                    .ok_or(ScrowError::InsufficientEscrowBalance)?;
                **treasury_info.try_borrow_mut_lamports()? = treasury_info
                    .lamports()
                    .checked_add(protocol_fee)
                    .ok_or(ScrowError::MathOverflow)?;
            }

            **escrow_info.try_borrow_mut_lamports()? = escrow_info
                .lamports()
                .checked_sub(recipient_payout)
                .ok_or(ScrowError::InsufficientEscrowBalance)?;
            **recipient_info.try_borrow_mut_lamports()? = recipient_info
                .lamports()
                .checked_add(recipient_payout)
                .ok_or(ScrowError::MathOverflow)?;

            emit!(WorkReviewed {
                escrow: escrow.key(),
                approved: true,
                attempts_used: escrow.attempts_used,
                escrow_state: EscrowState::Released,
            });
        } else {
            // Revision Action: Increment strike counter
            escrow.attempts_used = escrow
                .attempts_used
                .checked_add(1)
                .ok_or(ScrowError::MathOverflow)?;

            if escrow.attempts_used >= MAX_REVISION_ATTEMPTS {
                // Strike 3 reached: automatically set state to Refunded and return locked amount to creator
                escrow.escrow_state = EscrowState::Refunded;
                let refund_amount = escrow.amount;
                escrow.amount = 0;

                if refund_amount > 0 {
                    let escrow_info = escrow.to_account_info();
                    let creator_info = ctx.accounts.creator.to_account_info();

                    **escrow_info.try_borrow_mut_lamports()? = escrow_info
                        .lamports()
                        .checked_sub(refund_amount)
                        .ok_or(ScrowError::InsufficientEscrowBalance)?;
                    **creator_info.try_borrow_mut_lamports()? = creator_info
                        .lamports()
                        .checked_add(refund_amount)
                        .ok_or(ScrowError::MathOverflow)?;
                }
            } else {
                // Return to Pending so recipient can submit revised work
                escrow.escrow_state = EscrowState::Pending;
            }

            emit!(WorkReviewed {
                escrow: escrow.key(),
                approved: false,
                attempts_used: escrow.attempts_used,
                escrow_state: escrow.escrow_state,
            });
        }

        Ok(())
    }

    /// 4. `release_payout`: Deducts a 0.75% protocol fee sent directly to the sCrow Protocol Treasury,
    /// sends the remaining 99.25% to the recipient (if not already disbursed during review_work),
    /// and closes the Escrow PDA (`close = creator`) to reclaim 100% of the PDA SOL rent back to the creator.
    pub fn release_payout(ctx: Context<ReleasePayout>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(
            escrow.escrow_state == EscrowState::InReview
                || escrow.escrow_state == EscrowState::Released,
            ScrowError::InvalidEscrowState
        );

        let remaining_principal = escrow.amount;
        let mut protocol_fee: u64 = 0;
        let mut recipient_payout: u64 = 0;

        if remaining_principal > 0 {
            protocol_fee = remaining_principal
                .checked_mul(PROTOCOL_FEE_BPS)
                .ok_or(ScrowError::MathOverflow)?
                .checked_div(BPS_DENOMINATOR)
                .ok_or(ScrowError::MathOverflow)?;
            recipient_payout = remaining_principal
                .checked_sub(protocol_fee)
                .ok_or(ScrowError::MathOverflow)?;

            escrow.amount = 0;

            let escrow_info = escrow.to_account_info();
            let treasury_info = ctx.accounts.protocol_treasury.to_account_info();
            let recipient_info = ctx.accounts.recipient.to_account_info();

            if protocol_fee > 0 {
                **escrow_info.try_borrow_mut_lamports()? = escrow_info
                    .lamports()
                    .checked_sub(protocol_fee)
                    .ok_or(ScrowError::InsufficientEscrowBalance)?;
                **treasury_info.try_borrow_mut_lamports()? = treasury_info
                    .lamports()
                    .checked_add(protocol_fee)
                    .ok_or(ScrowError::MathOverflow)?;
            }

            **escrow_info.try_borrow_mut_lamports()? = escrow_info
                .lamports()
                .checked_sub(recipient_payout)
                .ok_or(ScrowError::InsufficientEscrowBalance)?;
            **recipient_info.try_borrow_mut_lamports()? = recipient_info
                .lamports()
                .checked_add(recipient_payout)
                .ok_or(ScrowError::MathOverflow)?;
        }

        escrow.escrow_state = EscrowState::Released;

        // Note: Anchor's `close = creator` constraint on `ctx.accounts.escrow` automatically
        // transfers 100% of the remaining rent-exempt lamports back to `creator` and zeroes account data.
        emit!(PayoutReleased {
            escrow: escrow.key(),
            creator: escrow.creator,
            recipient: escrow.recipient,
            protocol_treasury: escrow.protocol_treasury,
            recipient_payout,
            protocol_fee,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, terms_hash: [u8; 32])]
pub struct InitializeEscrow<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Recipient wallet address verified against escrow state on subsequent instructions
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: sCrow Protocol Treasury wallet receiving 0.75% settlement fee
    pub protocol_treasury: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = EscrowAccount::LEN,
        seeds = [b"escrow", creator.key().as_ref(), terms_hash.as_ref()],
        bump
    )]
    pub escrow: Account<'info, EscrowAccount>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitWork<'info> {
    #[account(mut)]
    pub recipient: Signer<'info>,

    #[account(
        mut,
        has_one = recipient @ ScrowError::UnauthorizedRecipient,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.terms_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct ReviewWork<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Verified via `has_one = recipient` on the escrow PDA
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Verified via `has_one = protocol_treasury` on the escrow PDA
    #[account(mut)]
    pub protocol_treasury: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = creator @ ScrowError::UnauthorizedCreator,
        has_one = recipient @ ScrowError::InvalidRecipientAccount,
        has_one = protocol_treasury @ ScrowError::InvalidTreasuryAccount,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.terms_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
}

#[derive(Accounts)]
pub struct ReleasePayout<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Verified via `has_one = recipient` on the escrow PDA
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,

    /// CHECK: Verified via `has_one = protocol_treasury` on the escrow PDA
    #[account(mut)]
    pub protocol_treasury: UncheckedAccount<'info>,

    #[account(
        mut,
        close = creator,
        has_one = creator @ ScrowError::UnauthorizedCreator,
        has_one = recipient @ ScrowError::InvalidRecipientAccount,
        has_one = protocol_treasury @ ScrowError::InvalidTreasuryAccount,
        seeds = [b"escrow", escrow.creator.as_ref(), escrow.terms_hash.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, EscrowAccount>,
}

#[account]
pub struct EscrowAccount {
    /// Creator who funded the escrow and holds review authority (32 bytes)
    pub creator: Pubkey,
    /// Recipient / contributor delivering the work (32 bytes)
    pub recipient: Pubkey,
    /// sCrow Protocol Treasury receiving 0.75% fee on release (32 bytes)
    pub protocol_treasury: Pubkey,
    /// Locked escrow principal in lamports (8 bytes)
    pub amount: u64,
    /// Number of revision strikes used (0..=3) (1 byte)
    pub attempts_used: u8,
    /// SHA-256 hash of agreed deliverable terms (32 bytes)
    pub terms_hash: [u8; 32],
    /// Optional Unix timestamp deadline for timed escrows (1 + 8 bytes)
    pub deadline: Option<i64>,
    /// Deterministic state machine status (1 byte)
    pub escrow_state: EscrowState,
    /// Latest submission proof URL (4 + 256 bytes)
    pub submission_url: String,
    /// Canonical PDA bump seed (1 byte)
    pub bump: u8,
}

impl EscrowAccount {
    pub const LEN: usize = 8  // Anchor account discriminator
        + 32                  // creator
        + 32                  // recipient
        + 32                  // protocol_treasury
        + 8                   // amount
        + 1                   // attempts_used
        + 32                  // terms_hash
        + 9                   // deadline (Option<i64>)
        + 1                   // escrow_state
        + (4 + MAX_SUBMISSION_URL_LEN) // submission_url
        + 1;                  // bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum EscrowState {
    Pending,
    InReview,
    Released,
    Refunded,
}

#[event]
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub creator: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub terms_hash: [u8; 32],
}

#[event]
pub struct WorkSubmitted {
    pub escrow: Pubkey,
    pub recipient: Pubkey,
    pub submission_url: String,
    pub attempts_used: u8,
}

#[event]
pub struct WorkReviewed {
    pub escrow: Pubkey,
    pub approved: bool,
    pub attempts_used: u8,
    pub escrow_state: EscrowState,
}

#[event]
pub struct PayoutReleased {
    pub escrow: Pubkey,
    pub creator: Pubkey,
    pub recipient: Pubkey,
    pub protocol_treasury: Pubkey,
    pub recipient_payout: u64,
    pub protocol_fee: u64,
}

#[error_code]
pub enum ScrowError {
    #[msg("Escrow deposit amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Submission proof URL must be non-empty and at most 256 characters.")]
    InvalidSubmissionUrl,
    #[msg("Operation not permitted in the current escrow state.")]
    InvalidEscrowState,
    #[msg("Maximum of 3 revision attempts has already been reached.")]
    MaxAttemptsReached,
    #[msg("Only the designated creator can review work or release payouts.")]
    UnauthorizedCreator,
    #[msg("Only the designated recipient can submit work.")]
    UnauthorizedRecipient,
    #[msg("Recipient account does not match the escrow PDA record.")]
    InvalidRecipientAccount,
    #[msg("Protocol treasury account does not match the escrow PDA record.")]
    InvalidTreasuryAccount,
    #[msg("Arithmetic overflow occurred while calculating payout splits.")]
    MathOverflow,
    #[msg("Escrow PDA has insufficient lamports for this transfer.")]
    InsufficientEscrowBalance,
}
