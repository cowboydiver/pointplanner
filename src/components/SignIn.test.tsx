/**
 * Tests for SignIn component — verifies:
 *   (a) entering an email + clicking request calls signInWithOtp and reveals the code step
 *   (b) entering a code + verifying calls verifyOtp
 *   (c) when isSupabaseConfigured() returns false, the not-configured notice shows
 *       and the request button is disabled
 *
 * Mocks ../lib/supabase at the module level, following the same pattern as
 * AuthProvider.test.tsx so no real network or credentials are needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SignIn } from './SignIn';

// ── Supabase mock ────────────────────────────────────────────────────────────

const mockSignInWithOtp = vi.fn().mockResolvedValue({ error: null });
const mockVerifyOtp = vi.fn().mockResolvedValue({ error: null });

let _configured = true;

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      signInWithOtp: mockSignInWithOtp,
      verifyOtp: mockVerifyOtp,
    },
  }),
  isSupabaseConfigured: () => _configured,
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SignIn — email + magic link / OTP flow', () => {
  beforeEach(() => {
    _configured = true;
    vi.clearAllMocks();
  });

  it('renders the sign-in heading', () => {
    render(<SignIn />);
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('calls signInWithOtp with the entered email and shows the code step', async () => {
    render(<SignIn />);

    const emailInput = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

    const requestBtn = screen.getByRole('button', { name: /send magic link/i });
    fireEvent.click(requestBtn);

    await waitFor(() => {
      expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'test@example.com' });
    });

    // After success, the OTP code entry step should be visible
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('123456')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument();
  });

  it('calls verifyOtp with the email and entered code', async () => {
    render(<SignIn />);

    // Step 1: request magic link
    const emailInput = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send magic link/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument();
    });

    // Step 2: enter the OTP code and verify
    const otpInput = screen.getByPlaceholderText('123456');
    fireEvent.change(otpInput, { target: { value: '654321' } });

    const verifyBtn = screen.getByRole('button', { name: /verify code/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        email: 'test@example.com',
        token: '654321',
        type: 'email',
      });
    });
  });
});

describe('SignIn — not configured', () => {
  beforeEach(() => {
    _configured = false;
    vi.clearAllMocks();
  });

  it('shows the not-configured notice and disables the form', () => {
    render(<SignIn />);

    // Heading still present so AuthProvider gating test can find it
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();

    // Notice shown
    expect(screen.getByText(/supabase is not configured/i)).toBeInTheDocument();

    // No email input or submit button
    expect(screen.queryByPlaceholderText('you@example.com')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send magic link/i })).not.toBeInTheDocument();
  });
});
