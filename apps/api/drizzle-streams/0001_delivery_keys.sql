CREATE TABLE "ev_delivery_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"delivery_id" bigint NOT NULL,
	"repeats" integer DEFAULT 0 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
