import { Pool, QueryResult } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool || (pool as any).ended) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DB || 'juspay_db',
      max: 5,
      idleTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export interface DbTransactionRecord {
  id: number;
  transaction_id: string;
  payment_reference: string;
  order_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method: string;
  customer_email?: string;
  otp_hash?: string | null;
  otp_attempts: number;
  resend_count: number;
  last_otp_sent_at?: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function queryTransaction(transactionId: string): Promise<DbTransactionRecord | null> {
  const query = `
    SELECT id, transaction_id, payment_reference, order_id, amount, currency,
           status, payment_method, customer_email, otp_hash, otp_attempts,
           resend_count, last_otp_sent_at, created_at, updated_at
    FROM payment_transactions
    WHERE transaction_id = $1
    LIMIT 1;
  `;
  const res: QueryResult<DbTransactionRecord> = await getPool().query(query, [transactionId]);
  return res.rows[0] || null;
}

export async function queryTransactionByReference(paymentReference: string): Promise<DbTransactionRecord | null> {
  const query = `
    SELECT id, transaction_id, payment_reference, order_id, amount, currency,
           status, payment_method, customer_email, otp_hash, otp_attempts,
           resend_count, last_otp_sent_at, created_at, updated_at
    FROM payment_transactions
    WHERE payment_reference = $1
    LIMIT 1;
  `;
  const res: QueryResult<DbTransactionRecord> = await getPool().query(query, [paymentReference]);
  return res.rows[0] || null;
}

export async function verifyTransactionInDb(
  identifier: { transactionId?: string; paymentReference?: string },
  expected: {
    status: string;
    amount?: number;
    paymentMethod?: string;
    currency?: string;
  }
): Promise<DbTransactionRecord> {
  let record: DbTransactionRecord | null = null;
  if (identifier.transactionId) {
    record = await queryTransaction(identifier.transactionId);
  } else if (identifier.paymentReference) {
    record = await queryTransactionByReference(identifier.paymentReference);
  }

  if (!record) {
    throw new Error(`Transaction record not found in PostgreSQL for identifier: ${JSON.stringify(identifier)}`);
  }

  if (record.status !== expected.status) {
    throw new Error(`DB status mismatch: expected '${expected.status}', got '${record.status}'`);
  }

  if (expected.amount !== undefined && Math.abs(Number(record.amount) - expected.amount) > 0.01) {
    throw new Error(`DB amount mismatch: expected ${expected.amount}, got ${record.amount}`);
  }

  if (expected.paymentMethod && record.payment_method !== expected.paymentMethod) {
    throw new Error(`DB payment method mismatch: expected '${expected.paymentMethod}', got '${record.payment_method}'`);
  }

  if (expected.currency && record.currency !== expected.currency) {
    throw new Error(`DB currency mismatch: expected '${expected.currency}', got '${record.currency}'`);
  }

  return record;
}

export async function queryStoreOrder(orderId: string): Promise<any | null> {
  const query = `
    SELECT id, order_id, status, subtotal, delivery_fee, total_amount, currency,
           stock_reserved, payment_transaction_id, payment_reference, created_at
    FROM store_orders
    WHERE order_id = $1
    LIMIT 1;
  `;
  const res = await getPool().query(query, [orderId]);
  return res.rows[0] || null;
}

export async function verifyStoreOrderInDb(
  orderId: string,
  expected: {
    status: string;
    subtotal?: number;
    deliveryFee?: number;
    totalAmount?: number;
  }
): Promise<any> {
  const record = await queryStoreOrder(orderId);
  if (!record) {
    throw new Error(`Store order '${orderId}' not found in PostgreSQL.`);
  }

  if (record.status !== expected.status) {
    throw new Error(`Store order status mismatch: expected '${expected.status}', got '${record.status}'`);
  }

  if (expected.subtotal !== undefined && Math.abs(Number(record.subtotal) - expected.subtotal) > 0.01) {
    throw new Error(`Subtotal mismatch: expected ${expected.subtotal}, got ${record.subtotal}`);
  }

  if (expected.deliveryFee !== undefined && Math.abs(Number(record.delivery_fee) - expected.deliveryFee) > 0.01) {
    throw new Error(`Delivery fee mismatch: expected ${expected.deliveryFee}, got ${record.delivery_fee}`);
  }

  if (expected.totalAmount !== undefined && Math.abs(Number(record.total_amount) - expected.totalAmount) > 0.01) {
    throw new Error(`Total amount mismatch: expected ${expected.totalAmount}, got ${record.total_amount}`);
  }

  return record;
}

export async function queryProductStock(productId: string): Promise<number> {
  const query = `
    SELECT stock_quantity
    FROM store_products
    WHERE id = $1
    LIMIT 1;
  `;
  const res = await getPool().query(query, [productId]);
  if (!res.rows[0]) throw new Error(`Product ${productId} not found in DB`);
  return res.rows[0].stock_quantity;
}

export async function expireTransactionOtpInDb(transactionId: string): Promise<void> {
  const query = `
    UPDATE payment_transactions
    SET otp_expires_at = timezone('utc', NOW()) - INTERVAL '10 minutes',
        last_otp_sent_at = timezone('utc', NOW()) - INTERVAL '10 minutes'
    WHERE transaction_id = $1;
  `;
  await getPool().query(query, [transactionId]);
}

export async function closeDbPool(): Promise<void> {
  if (pool && !(pool as any).ended) {
    try {
      await pool.end();
    } catch {}
  }
  pool = null;
}
