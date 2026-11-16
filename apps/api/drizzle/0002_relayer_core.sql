CREATE TABLE "auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intro_links" (
	"code" text PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"referrer" text NOT NULL,
	"link_type" integer NOT NULL,
	"terms_version" integer NOT NULL,
	"issued_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"nonce" text NOT NULL,
	"signature" text NOT NULL,
	"intro_hash" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "intro_links_intro_hash_unique" UNIQUE("intro_hash")
);
--> statement-breakpoint
CREATE TABLE "link_opens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"opener" text,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"venue" text NOT NULL,
	"order_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"signature" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"label" text,
	"created_by" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_venue_order_id_pk" PRIMARY KEY("venue","order_id")
);
--> statement-breakpoint
CREATE TABLE "owner_actions" (
	"id" text PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"typed_message" jsonb NOT NULL,
	"owner_nonce" text NOT NULL,
	"deadline" bigint NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"signature" text,
	"relay_tx_id" text,
	"tx_hash" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"venue" text NOT NULL,
	"order_id" text NOT NULL,
	"customer" text NOT NULL,
	"amount" bigint NOT NULL,
	"quote" jsonb NOT NULL,
	"weights" jsonb NOT NULL,
	"weights_sig" text NOT NULL,
	"weights_hash" text NOT NULL,
	"attribution" jsonb,
	"auth" jsonb NOT NULL,
	"submitter" text NOT NULL,
	"deadline" bigint NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"relay_tx_id" text,
	"tx_hash" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relay_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"user_address" text NOT NULL,
	"status" text NOT NULL,
	"nonce" integer,
	"hash" text,
	"hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"gas_limit" bigint,
	"max_fee_per_gas" text,
	"gas_used" bigint,
	"block_number" bigint,
	"error_code" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"address" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"passkey_credential_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues_meta" (
	"venue" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"salt" text NOT NULL,
	"payout" text NOT NULL,
	"signer" text NOT NULL,
	"attributor" text NOT NULL,
	"reward_bps" integer NOT NULL,
	"min_order" bigint NOT NULL,
	"metadata_uri" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"typed_message" jsonb NOT NULL,
	"owner_nonce" text NOT NULL,
	"deadline" bigint NOT NULL,
	"relay_tx_id" text,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_meta_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE INDEX "intro_links_referrer_idx" ON "intro_links" USING btree ("referrer");--> statement-breakpoint
CREATE INDEX "intro_links_venue_idx" ON "intro_links" USING btree ("venue");--> statement-breakpoint
CREATE INDEX "link_opens_code_idx" ON "link_opens" USING btree ("code");--> statement-breakpoint
CREATE INDEX "owner_actions_owner_idx" ON "owner_actions" USING btree ("owner","status");--> statement-breakpoint
CREATE INDEX "payment_intents_order_idx" ON "payment_intents" USING btree ("venue","order_id");--> statement-breakpoint
CREATE INDEX "payment_intents_customer_idx" ON "payment_intents" USING btree ("customer");--> statement-breakpoint
CREATE INDEX "relay_txs_ref_idx" ON "relay_txs" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "relay_txs_status_idx" ON "relay_txs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_address_idx" ON "sessions" USING btree ("address");--> statement-breakpoint
CREATE INDEX "venues_meta_owner_idx" ON "venues_meta" USING btree ("owner");