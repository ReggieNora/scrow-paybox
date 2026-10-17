use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("28t38U7muxeGwWkigpJVaha8nHddnfZdnCYBBfb9RVE1");

/// Native-SOL escrow.
///
/// * `create_escrow` – the buyer locks `amount` lamports for a seller in a PDA
///   derived from `["escrow", buyer, escrow_id (u64 LE)]`.
/// * `release` – the buyer sends the locked lamports to the seller. The PDA's
///   rent deposit goes back to the buyer.
/// * `refund` – once `refund_after` has passed, the buyer reclaims everything.
///
/// Every instruction is signed only by the buyer, who is also the fee payer.
#[program]
pub mod scrow {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        escrow_id: u64,
        amount: u64,
        refund_after: i64,
    ) -> Result<()> {
        require!(amount > 0, ScrowError::ZeroAmount);
        require_keys_neq!(
            ctx.accounts.buyer.key(),
            ctx.accounts.seller.key(),
            ScrowError::SellerIsBuyer
        );
        let now = Clock::get()?.unix_timestamp;
        require!(refund_after > now, ScrowError::DeadlineInPast);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.escrow_id = escrow_id;
        escrow.amount = amount;
        escrow.refund_after = refund_after;
        escrow.bump = ctx.bumps.escrow;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        ctx.accounts.escrow.sub_lamports(amount)?;
        ctx.accounts.seller.add_lamports(amount)?;
        // `close = buyer` returns the remaining rent deposit to the buyer.
        Ok(())
    }

    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.escrow.refund_after,
            ScrowError::RefundTooEarly
        );
        // `close = buyer` returns the locked amount and rent deposit.
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(escrow_id: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: The seller only receives lamports on release; any address is allowed.
    pub seller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), &escrow_id.to_le_bytes()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: Must match the seller recorded in the escrow.
    #[account(mut, address = escrow.seller @ ScrowError::WrongSeller)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ ScrowError::WrongBuyer,
        seeds = [b"escrow", buyer.key().as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ ScrowError::WrongBuyer,
        seeds = [b"escrow", buyer.key().as_ref(), &escrow.escrow_id.to_le_bytes()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub escrow_id: u64,
    pub amount: u64,
    pub refund_after: i64,
    pub bump: u8,
}

#[error_code]
pub enum ScrowError {
    #[msg("Escrow amount must be greater than zero")]
    ZeroAmount,
    #[msg("Seller must be different from the buyer")]
    SellerIsBuyer,
    #[msg("Refund deadline must be in the future")]
    DeadlineInPast,
    #[msg("Seller does not match this escrow")]
    WrongSeller,
    #[msg("Buyer does not match this escrow")]
    WrongBuyer,
    #[msg("Refund deadline has not passed yet")]
    RefundTooEarly,
}
