ALTER TABLE "relay_txs" ADD COLUMN "venue" text;--> statement-breakpoint
ALTER TABLE "relay_txs" ADD COLUMN "fee_usdc" bigint;--> statement-breakpoint
CREATE INDEX "relay_txs_created_idx" ON "relay_txs" USING btree ("created_at");