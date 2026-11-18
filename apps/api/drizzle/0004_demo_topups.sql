CREATE TABLE "demo_topups" (
	"address" text PRIMARY KEY NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"funder" text,
	"relay_tx_id" text,
	"tx_hash" text,
	"error_code" text,
	"ip_hash" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "demo_topups_claimed_idx" ON "demo_topups" USING btree ("claimed_at");