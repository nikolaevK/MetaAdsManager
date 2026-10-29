CREATE TABLE `launch_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`ad_account_id` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`launch_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`launch_id`) REFERENCES `launches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `launch_drafts_client_idx` ON `launch_drafts` (`client_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `launch_drafts_launch_idx` ON `launch_drafts` (`launch_id`);