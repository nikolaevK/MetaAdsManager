CREATE INDEX `jobs_type_created_idx` ON `jobs` (`type`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_finished_idx` ON `jobs` (`finished_at`);--> statement-breakpoint
CREATE INDEX `jobs_updated_idx` ON `jobs` (`updated_at`);--> statement-breakpoint
CREATE INDEX `launch_drafts_account_idx` ON `launch_drafts` (`ad_account_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `launch_objects_meta_idx` ON `launch_objects` (`meta_id`);--> statement-breakpoint
CREATE INDEX `launches_client_idx` ON `launches` (`client_id`,`created_at`);