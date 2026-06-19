CREATE TYPE "public"."job_status" AS ENUM('queued', 'discovering', 'verifying', 'completed', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('unverified_raw', 'verified', 'rejected');
--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');
--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('search_charge');
--> statement-breakpoint
CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "credits" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organizations_credits_nonnegative" CHECK ("organizations"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
  "user_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "role" "membership_role" DEFAULT 'member' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_memberships_user_id_organization_id_pk" PRIMARY KEY("user_id", "organization_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "active_organization_id" uuid NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "search_input" jsonb NOT NULL,
  "status" "job_status" DEFAULT 'queued' NOT NULL,
  "discovered_count" integer DEFAULT 0 NOT NULL,
  "verified_count" integer DEFAULT 0 NOT NULL,
  "rejected_count" integer DEFAULT 0 NOT NULL,
  "error_message" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "search_jobs_org_idempotency_unique" UNIQUE("organization_id", "idempotency_key"),
  CONSTRAINT "search_jobs_id_org_unique" UNIQUE("id", "organization_id"),
  CONSTRAINT "search_jobs_discovered_nonnegative" CHECK ("search_jobs"."discovered_count" >= 0),
  CONSTRAINT "search_jobs_verified_nonnegative" CHECK ("search_jobs"."verified_count" >= 0),
  CONSTRAINT "search_jobs_rejected_nonnegative" CHECK ("search_jobs"."rejected_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "provider_candidate_key" text NOT NULL,
  "name" text NOT NULL,
  "company" text NOT NULL,
  "title" text NOT NULL,
  "email" text NOT NULL,
  "source_url" text NOT NULL,
  "status" "lead_status" DEFAULT 'unverified_raw' NOT NULL,
  "verification_score" integer,
  "rejection_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "leads_job_candidate_unique" UNIQUE("job_id", "provider_candidate_key"),
  CONSTRAINT "leads_verification_score_range" CHECK ("leads"."verification_score" IS NULL OR ("leads"."verification_score" >= 0 AND "leads"."verification_score" <= 100))
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "job_id" uuid NOT NULL,
  "amount" integer NOT NULL,
  "transaction_type" "credit_transaction_type" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "credit_transactions_search_charge_negative" CHECK ("credit_transactions"."amount" = -1)
);
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "search_jobs" ADD CONSTRAINT "search_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_job_organization_fk" FOREIGN KEY ("job_id", "organization_id") REFERENCES "public"."search_jobs"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_job_organization_fk" FOREIGN KEY ("job_id", "organization_id") REFERENCES "public"."search_jobs"("id", "organization_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "memberships_org_idx" ON "organization_memberships" USING btree ("organization_id");
--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "search_jobs_org_created_idx" ON "search_jobs" USING btree ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX "leads_org_status_created_idx" ON "leads" USING btree ("organization_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX "leads_org_job_idx" ON "leads" USING btree ("organization_id", "job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_one_search_charge_per_job" ON "credit_transactions" USING btree ("job_id") WHERE "transaction_type" = 'search_charge';
--> statement-breakpoint
CREATE INDEX "credit_transactions_org_created_idx" ON "credit_transactions" USING btree ("organization_id", "created_at");
