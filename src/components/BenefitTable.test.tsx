import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { benefitInstance } from '../test/fixtures';
import { BenefitTable } from './BenefitTable';

describe('BenefitTable', () => {
  it('renders status, remaining value, provider, period, and detail link', () => {
    render(
      <MemoryRouter>
        <BenefitTable instances={[benefitInstance()]} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('table', { name: /benefit periods/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '$15 monthly rideshare credit' })).toHaveAttribute(
      'href',
      '/instances/11111111-1111-4111-8111-111111111111',
    );
    expect(screen.getByText('Expiring Soon · Partially Used')).toBeInTheDocument();
    expect(screen.getByText('$10')).toBeInTheDocument();
    expect(screen.getByText(/Travel Card — Personal/)).toBeInTheDocument();
    expect(screen.getByText('5 days')).toHaveClass('text-danger');
  });

  it('labels uncapped cashback honestly', () => {
    render(
      <MemoryRouter>
        <BenefitTable
          instances={[
            benefitInstance({
              available_quantity: null,
              remaining_quantity: null,
              value_kind: 'percentage_cashback',
              usage_status: 'unused',
            }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Uncapped')).toBeInTheDocument();
    expect(screen.getByText(/of Uncapped remaining/)).toBeInTheDocument();
  });

  it('shows cashback rate, cap balance, and minimum spend together', () => {
    render(
      <MemoryRouter>
        <BenefitTable
          instances={[
            benefitInstance({
              value_kind: 'percentage_cashback',
              cashback_percentage: 10,
              minimum_spend: 75,
              available_quantity: 50,
              redeemed_quantity: 0,
              remaining_quantity: 50,
            }),
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('10% cashback · $75 minimum spend')).toBeInTheDocument();
    expect(screen.getByText('$50')).toBeInTheDocument();
  });
});
