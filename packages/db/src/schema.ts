import type { JobSearchInput } from '@lead/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'discovering',
  'verifying',
  'completed',
  'failed',
  'cancelled'
]);

export const leadStatusEnum = pgEnum('lead_status', ['unverified_raw', 'verified', 'rejected']);

export const membershipRoleEnum = pgEnum('membership_role', ['owner', 'member']);
export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', ['search_charge']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    credits: integer('credits').notNull().default(0),
    ...timestamps
  },
  (table) => [check('organizations_credits_nonnegative', sql`${table.credits} >= 0`)]
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  ...timestamps
});

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: membershipRoleEnum('role').notNull().default('member'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.organizationId] }),
    index('memberships_org_idx').on(table.organizationId)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => [index('sessions_expiry_idx').on(table.expiresAt)]
);

export const searchJobs = pgTable(
  'search_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKey: uuid('idempotency_key').notNull(),
    searchInput: jsonb('search_input').$type<JobSearchInput>().notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    discoveredCount: integer('discovered_count').notNull().default(0),
    verifiedCount: integer('verified_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    unique('search_jobs_org_idempotency_unique').on(table.organizationId, table.idempotencyKey),
    unique('search_jobs_id_org_unique').on(table.id, table.organizationId),
    index('search_jobs_org_created_idx').on(table.organizationId, table.createdAt),
    check('search_jobs_discovered_nonnegative', sql`${table.discoveredCount} >= 0`),
    check('search_jobs_verified_nonnegative', sql`${table.verifiedCount} >= 0`),
    check('search_jobs_rejected_nonnegative', sql`${table.rejectedCount} >= 0`)
  ]
);

export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    jobId: uuid('job_id').notNull(),
    providerCandidateKey: text('provider_candidate_key').notNull(),
    name: text('name').notNull(),
    company: text('company').notNull(),
    title: text('title').notNull(),
    email: text('email').notNull(),
    sourceUrl: text('source_url').notNull(),
    status: leadStatusEnum('status').notNull().default('unverified_raw'),
    verificationScore: integer('verification_score'),
    rejectionReason: text('rejection_reason'),
    ...timestamps
  },
  (table) => [
    unique('leads_job_candidate_unique').on(table.jobId, table.providerCandidateKey),
    index('leads_org_status_created_idx').on(table.organizationId, table.status, table.createdAt),
    index('leads_org_job_idx').on(table.organizationId, table.jobId),
    foreignKey({
      columns: [table.jobId, table.organizationId],
      foreignColumns: [searchJobs.id, searchJobs.organizationId],
      name: 'leads_job_organization_fk'
    }).onDelete('cascade'),
    check(
      'leads_verification_score_range',
      sql`${table.verificationScore} IS NULL OR (${table.verificationScore} >= 0 AND ${table.verificationScore} <= 100)`
    )
  ]
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull(),
    amount: integer('amount').notNull(),
    transactionType: creditTransactionTypeEnum('transaction_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('credit_transactions_one_search_charge_per_job')
      .on(table.jobId)
      .where(sql`${table.transactionType} = 'search_charge'`),
    check('credit_transactions_search_charge_negative', sql`${table.amount} = -1`),
    foreignKey({
      columns: [table.jobId, table.organizationId],
      foreignColumns: [searchJobs.id, searchJobs.organizationId],
      name: 'credit_transactions_job_organization_fk'
    }).onDelete('cascade'),
    index('credit_transactions_org_created_idx').on(table.organizationId, table.createdAt)
  ]
);
