import { render, screen } from '@testing-library/react';
import { App } from './App';
import { AuthProvider } from './features/auth/AuthProvider';

describe('authentication guard', () => {
  it('shows setup guidance without leaking or inventing backend credentials', () => {
    render(
      <AuthProvider>
        <App />
      </AuthProvider>,
    );
    expect(screen.getByTestId('auth-screen')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /connect your private database/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No service-role or email secret belongs in the browser/i),
    ).toBeInTheDocument();
  });
});
