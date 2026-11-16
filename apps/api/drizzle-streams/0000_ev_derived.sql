CREATE TABLE "ev_ambassadors" (
	"address" text NOT NULL,
	"venue" text NOT NULL,
	"customers_credited" integer NOT NULL,
	"l1_earned" numeric(78, 0) NOT NULL,
	"l2_earned" numeric(78, 0) NOT NULL,
	"cashback_earned" numeric(78, 0) NOT NULL,
	CONSTRAINT "ev_ambassadors_address_venue_pk" PRIMARY KEY("address","venue")
);
--> statement-breakpoint
CREATE TABLE "ev_cursor" (
	"id" text PRIMARY KEY NOT NULL,
	"last_block" bigint,
	"last_log_index" integer,
	"events" integer DEFAULT 0 NOT NULL,
	"last_batch_end" bigint,
	"rebuilds" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_events" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text,
	"tx_index" integer,
	"address" text NOT NULL,
	"event" text NOT NULL,
	"topic0" text NOT NULL,
	"args" jsonb NOT NULL,
	"topics" jsonb NOT NULL,
	"data" text NOT NULL,
	"block_timestamp" bigint,
	"source" text NOT NULL,
	"delivery_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ev_events_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "ev_ingest_log" (
	"delivery_id" bigint PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"logs" integer DEFAULT 0 NOT NULL,
	"new_events" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"ignored" integer DEFAULT 0 NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_intros" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"venue" text NOT NULL,
	"referrer" text NOT NULL,
	"customer" text NOT NULL,
	"intro_hash" text NOT NULL,
	"terms_version" integer NOT NULL,
	"link_type" integer NOT NULL,
	"expires_at" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint,
	"live" boolean DEFAULT true NOT NULL,
	"dropped_reason" integer,
	"dropped_tx" text,
	CONSTRAINT "ev_intros_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "ev_payments" (
	"venue" text NOT NULL,
	"order_id" text NOT NULL,
	"customer" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"venue_amount" numeric(78, 0) NOT NULL,
	"reward_pool" numeric(78, 0) NOT NULL,
	"first_purchase" boolean NOT NULL,
	"rewarded" boolean NOT NULL,
	"weights_mode" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint,
	CONSTRAINT "ev_payments_venue_order_id_pk" PRIMARY KEY("venue","order_id")
);
--> statement-breakpoint
CREATE TABLE "ev_rewards" (
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"order_id" text NOT NULL,
	"venue" text NOT NULL,
	"customer" text NOT NULL,
	"recipient" text NOT NULL,
	"role" integer NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"via_referrer" text NOT NULL,
	"returned" boolean NOT NULL,
	"return_reason" integer,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint,
	CONSTRAINT "ev_rewards_tx_hash_log_index_pk" PRIMARY KEY("tx_hash","log_index")
);
--> statement-breakpoint
CREATE TABLE "ev_seeds" (
	"venue" text NOT NULL,
	"ambassador" text NOT NULL,
	"allowed" boolean NOT NULL,
	"tx_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	CONSTRAINT "ev_seeds_venue_ambassador_pk" PRIMARY KEY("venue","ambassador")
);
--> statement-breakpoint
CREATE TABLE "ev_terms" (
	"venue" text NOT NULL,
	"terms_version" integer NOT NULL,
	"reward_bps" integer NOT NULL,
	"min_order" numeric(78, 0) NOT NULL,
	"effective_at" bigint NOT NULL,
	"tx_hash" text NOT NULL,
	"block_number" bigint NOT NULL,
	CONSTRAINT "ev_terms_venue_terms_version_pk" PRIMARY KEY("venue","terms_version")
);
--> statement-breakpoint
CREATE TABLE "ev_venue_stats" (
	"venue" text PRIMARY KEY NOT NULL,
	"verified_customers" integer NOT NULL,
	"payments" integer NOT NULL,
	"rewarded_payments" integer NOT NULL,
	"gross" numeric(78, 0) NOT NULL,
	"venue_received" numeric(78, 0) NOT NULL,
	"rewards_paid" numeric(78, 0) NOT NULL,
	"rewards_returned" numeric(78, 0) NOT NULL,
	"cashback_paid" numeric(78, 0) NOT NULL,
	"l1_paid" numeric(78, 0) NOT NULL,
	"l2_paid" numeric(78, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ev_venues" (
	"venue" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"salt" text NOT NULL,
	"payout" text NOT NULL,
	"signer" text NOT NULL,
	"attributor" text NOT NULL,
	"metadata_uri" text NOT NULL,
	"terms_version" integer,
	"reward_bps" integer,
	"min_order" numeric(78, 0),
	"registered_tx" text NOT NULL,
	"registered_block" bigint NOT NULL,
	"keys_tx" text
);
--> statement-breakpoint
CREATE TABLE "ev_verified" (
	"venue" text NOT NULL,
	"customer" text NOT NULL,
	"introducer" text NOT NULL,
	"order_id" text NOT NULL,
	"tx_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" bigint,
	CONSTRAINT "ev_verified_venue_customer_pk" PRIMARY KEY("venue","customer")
);
--> statement-breakpoint
CREATE INDEX "ev_events_order_idx" ON "ev_events" USING btree ("block_number","log_index");--> statement-breakpoint
CREATE INDEX "ev_intros_vc_idx" ON "ev_intros" USING btree ("venue","customer");--> statement-breakpoint
CREATE INDEX "ev_intros_referrer_idx" ON "ev_intros" USING btree ("referrer");--> statement-breakpoint
CREATE INDEX "ev_payments_tx_idx" ON "ev_payments" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "ev_payments_customer_idx" ON "ev_payments" USING btree ("customer");--> statement-breakpoint
CREATE INDEX "ev_rewards_recipient_idx" ON "ev_rewards" USING btree ("recipient");--> statement-breakpoint
CREATE INDEX "ev_rewards_order_idx" ON "ev_rewards" USING btree ("venue","order_id");