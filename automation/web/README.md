# JUSPAY Payment Gateway - Playwright Automation Framework

Professional Playwright automated testing framework for the simulated JUSPAY Payment Gateway challenge.

## 1. Architecture

```text
automation/web/
├── playwright.config.ts    # Chromium config, HTML reporting, trace/video/screenshots
├── tsconfig.json           # TypeScript configuration with path aliases
├── package.json            # Automation dependencies (@playwright/test, pg, typescript)
├── pages/                  # Page Object Models (POM)
│   ├── BasePage.ts         # Base navigation and screenshot utilities
│   ├── CheckoutPage.ts     # Checkout selector, forms (Card, UPI, NetBanking), actions
│   ├── OtpPage.ts          # OTP verification, simulation helpers, countdown, attempts
│   └── ResultPage.ts       # Result states (SUCCESS, DECLINED, FAILED)
├── fixtures/               # Test fixtures and database pool teardown
│   └── payment-fixture.ts
├── utils/                  # Reusable utilities
│   ├── db.ts               # Direct PostgreSQL database verification (pg Pool)
│   └── api.ts              # FastAPI simulated payment & OTP interaction helpers
├── test-data/              # Data-driven test datasets
│   └── payment-data.ts     # Valid/invalid cards, VPAs, banks, and outcome triggers
├── tests/                  # Playwright Test Suites
│   ├── card-payment.spec.ts        # 13-step Card payment journey & DB audit
│   ├── upi-payment.spec.ts         # UPI payment journey & DB audit
│   ├── netbanking-payment.spec.ts  # Net Banking journey & DB audit
│   ├── negative-scenarios.spec.ts  # Validation, lockout, cooldown, empty OTP
│   └── payment-outcomes.spec.ts    # Deterministic SUCCESS, DECLINED, FAILED
└── README.md
```

## 2. Requirements & Prerequisites

- **Node.js**: v18+ (tested on Node v24.21.0)
- **FastAPI Backend**: Running on `http://localhost:8001`
- **Next.js Frontend**: Running on `http://localhost:3001`
- **PostgreSQL Database**: Running on `localhost:5433` (Docker container `juspay_postgres`)

## 3. PowerShell Execution Commands

### Run all automated tests
```powershell
cd automation\web
npx playwright test
```

### Run tests with interactive UI / headed browser
```powershell
npx playwright test --headed
```

### Run specific test suites
```powershell
# Card payment journey
npx playwright test tests/card-payment.spec.ts

# UPI payment journey
npx playwright test tests/upi-payment.spec.ts

# Net Banking journey
npx playwright test tests/netbanking-payment.spec.ts

# Negative & error handling scenarios
npx playwright test tests/negative-scenarios.spec.ts

# Payment outcomes (SUCCESS, DECLINED, FAILED)
npx playwright test tests/payment-outcomes.spec.ts
```

### View Playwright HTML Report
```powershell
npx playwright show-report
```

## 4. Test Scenarios Automated

| Suite | Scenarios | PostgreSQL Verifications |
| :--- | :--- | :--- |
| **Card Payment** | Full checkout $\rightarrow$ Card form $\rightarrow$ OTP entry $\rightarrow$ Result | `status='SUCCESS'`, `payment_method='CARD'`, `otp_hash=NULL` |
| **UPI Payment** | UPI VPA selection $\rightarrow$ OTP entry $\rightarrow$ Result | `status='SUCCESS'`, `payment_method='UPI'` |
| **Net Banking** | Bank selection (HDFC) $\rightarrow$ OTP entry $\rightarrow$ Result | `status='SUCCESS'`, `payment_method='NET_BANKING'` |
| **Negative Tests** | Invalid Card number, Malformed UPI, Empty OTP, Wrong OTP attempt decrements, 3-attempt Lockout, Resend cooldown, Duplicate submit prevention | Correct `status='PENDING'` or `status='FAILED'`, attempt counters |
| **Payment Outcomes** | Deterministic SUCCESS, DECLINED, FAILED simulation triggers | `status='SUCCESS'`, `status='DECLINED'`, `status='FAILED'` |

## 5. Security & Isolation

- **Zero Real Credentials**: Uses simulated demo card numbers, demo VPAs, and demo banks.
- **Development-Only OTP Access**: Leverages the authorized `simulated_otp` helper exposed only when `ENVIRONMENT=development`.
- **Database Teardown**: Pool is gracefully disconnected after test runs via `payment-fixture.ts`.
