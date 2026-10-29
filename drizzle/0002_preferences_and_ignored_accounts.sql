CREATE TABLE `ignored_ad_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`ignored_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`ignored_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
