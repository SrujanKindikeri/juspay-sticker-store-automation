export const validCardData = {
  cardNumber: '4111 2222 3333 4444',
  expiry: '12/28',
  cvv: '123',
  cardHolder: 'DEMO TESTER',
};

export const declineCardData = {
  cardNumber: '4111 2222 3333 4444',
  expiry: '12/28',
  cvv: '123',
  cardHolder: 'SIMULATE DECLINE',
};

export const failCardData = {
  cardNumber: '4111 2222 3333 4444',
  expiry: '12/28',
  cvv: '123',
  cardHolder: 'SIMULATE FAIL',
};

export const invalidCardData = {
  shortNumber: '4111 2222',
  invalidExpiry: '13/99',
  shortCvv: '12',
  emptyHolder: '   ',
};

export const validUpiData = {
  upiId: 'demo.tester@okaxis',
};

export const declineUpiData = {
  upiId: 'demo.decline@okaxis',
};

export const failUpiData = {
  upiId: 'demo.fail@okaxis',
};

export const invalidUpiData = {
  noAtSymbol: 'invalidupihandle',
  shortUsername: 'a@b',
  specialChars: 'test!@#$@bank',
};

export const supportedBanks = [
  { code: 'HDFC', name: 'HDFC Bank' },
  { code: 'ICICI', name: 'ICICI Bank' },
  { code: 'SBI', name: 'State Bank of India' },
  { code: 'AXIS', name: 'Axis Bank' },
  { code: 'KOTAK', name: 'Kotak Mahindra Bank' },
];

export const orderAmounts = {
  standard: 999.00,
  currency: 'INR',
};
