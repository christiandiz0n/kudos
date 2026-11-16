CREATE TABLE "stream_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified" boolean NOT NULL,
	"stream_id" text,
	"batch_start" bigint,
	"batch_end" bigint,
	"event_count" integer DEFAULT 0 NOT NULL,
	"bytes" integer NOT NULL,
	"gzip" boolean DEFAULT false NOT NULL,
	"headers" jsonb NOT NULL,
	"summary" jsonb,
	"body" jsonb,
	"body_text" text
);
--> statement-breakpoint
CREATE INDEX "stream_deliveries_received_at_idx" ON "stream_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "stream_deliveries_stream_batch_idx" ON "stream_deliveries" USING btree ("stream_id","batch_start");