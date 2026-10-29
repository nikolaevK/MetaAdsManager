CREATE TABLE `ad_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`timezone_name` text DEFAULT 'America/Los_Angeles' NOT NULL,
	`account_status` integer,
	`business_id` text,
	`default_page_id` text,
	`default_instagram_user_id` text,
	`last_structure_sync_at` integer,
	`last_insights_sync_at` integer,
	`last_full_insights_sync_at` integer,
	`last_review_sync_at` integer,
	`insights_backfilled_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ad_accounts_client_idx` ON `ad_accounts` (`client_id`);--> statement-breakpoint
CREATE TABLE `ads` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_account_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`adset_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`effective_status` text NOT NULL,
	`creative_id` text,
	`thumbnail_url` text,
	`review_feedback` text,
	`issues_info` text,
	`created_time` text,
	`updated_time` text,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ads_account_idx` ON `ads` (`ad_account_id`);--> statement-breakpoint
CREATE INDEX `ads_adset_idx` ON `ads` (`adset_id`);--> statement-breakpoint
CREATE INDEX `ads_campaign_idx` ON `ads` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `ads_status_idx` ON `ads` (`ad_account_id`,`effective_status`);--> statement-breakpoint
CREATE TABLE `adsets` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_account_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`effective_status` text NOT NULL,
	`daily_budget` integer,
	`lifetime_budget` integer,
	`optimization_goal` text,
	`billing_event` text,
	`promoted_object` text,
	`start_time` text,
	`end_time` text,
	`created_time` text,
	`updated_time` text,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `adsets_account_idx` ON `adsets` (`ad_account_id`);--> statement-breakpoint
CREATE INDEX `adsets_campaign_idx` ON `adsets` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_account_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`effective_status` text NOT NULL,
	`objective` text,
	`daily_budget` integer,
	`lifetime_budget` integer,
	`bid_strategy` text,
	`start_time` text,
	`stop_time` text,
	`created_time` text,
	`updated_time` text,
	`synced_at` integer NOT NULL,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `campaigns_account_idx` ON `campaigns` (`ad_account_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`naming_convention_id` text,
	`utm_rule_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`naming_convention_id`) REFERENCES `naming_conventions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`utm_rule_id`) REFERENCES `utm_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `creative_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`aspect` text NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assets_client_idx` ON `creative_assets` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assets_client_sha_idx` ON `creative_assets` (`client_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `creatives` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`square_asset_id` text NOT NULL,
	`vertical_asset_id` text NOT NULL,
	`angle` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`square_asset_id`) REFERENCES `creative_assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`vertical_asset_id`) REFERENCES `creative_assets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `creatives_client_idx` ON `creatives` (`client_id`);--> statement-breakpoint
CREATE TABLE `insights_daily` (
	`ad_id` text NOT NULL,
	`date` text NOT NULL,
	`ad_account_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`adset_id` text NOT NULL,
	`spend` real DEFAULT 0 NOT NULL,
	`impressions` integer DEFAULT 0 NOT NULL,
	`clicks` integer DEFAULT 0 NOT NULL,
	`link_clicks` integer DEFAULT 0 NOT NULL,
	`results` real DEFAULT 0 NOT NULL,
	`result_type` text,
	`purchases` real DEFAULT 0 NOT NULL,
	`purchase_value` real DEFAULT 0 NOT NULL,
	`leads` real DEFAULT 0 NOT NULL,
	`actions` text,
	`synced_at` integer NOT NULL,
	PRIMARY KEY(`ad_id`, `date`)
);
--> statement-breakpoint
CREATE INDEX `insights_account_date_idx` ON `insights_daily` (`ad_account_id`,`date`);--> statement-breakpoint
CREATE INDEX `insights_campaign_date_idx` ON `insights_daily` (`campaign_id`,`date`);--> statement-breakpoint
CREATE INDEX `insights_adset_date_idx` ON `insights_daily` (`adset_id`,`date`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`run_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 6 NOT NULL,
	`last_error` text,
	`locked_at` integer,
	`locked_by` text,
	`dedupe_key` text,
	`ad_account_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `jobs_ready_idx` ON `jobs` (`status`,`run_at`,`priority`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_active_idx` ON `jobs` (`dedupe_key`) WHERE "jobs"."status" in ('queued', 'running') and "jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE TABLE `launch_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`launch_id` text NOT NULL,
	`ref` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`meta_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`launch_id`) REFERENCES `launches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launch_objects_ref_idx` ON `launch_objects` (`launch_id`,`ref`);--> statement-breakpoint
CREATE TABLE `launch_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`client_id` text,
	`config` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `launches` (
	`id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`client_id` text NOT NULL,
	`ad_account_id` text NOT NULL,
	`template_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`step` text,
	`spec` text NOT NULL,
	`error` text,
	`meta_campaign_id` text,
	`created_by` text,
	`approved_by` text,
	`approved_at` integer,
	`activated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `launch_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launches_idempotency_key_unique` ON `launches` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `launches_account_idx` ON `launches` (`ad_account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`first_at` integer NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE TABLE `meta_media` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`ad_account_id` text NOT NULL,
	`image_hash` text,
	`image_url` text,
	`video_id` text,
	`video_status` text,
	`thumbnail_url` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `creative_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meta_media_asset_account_idx` ON `meta_media` (`asset_id`,`ad_account_id`);--> statement-breakpoint
CREATE TABLE `naming_conventions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`campaign_pattern` text NOT NULL,
	`adset_pattern` text NOT NULL,
	`ad_pattern` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limit_state` (
	`key` text PRIMARY KEY NOT NULL,
	`usage_pct` real DEFAULT 0 NOT NULL,
	`blocked_until` integer,
	`raw` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_id` text NOT NULL,
	`ad_account_id` text NOT NULL,
	`ad_name` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`feedback` text,
	`issues` text,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer,
	`acknowledged_by` text,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_events_account_idx` ON `review_events` (`ad_account_id`,`acknowledged_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'buyer' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `utm_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`params` text NOT NULL,
	`created_at` integer NOT NULL
);
