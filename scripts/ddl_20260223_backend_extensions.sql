-- Ink-Aesthetics AI backend extension DDL
-- Target: MySQL 8.0+
-- Mode: Incremental / idempotent

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1) New tables for queue/counter/security/workspace/community
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS counter_sync_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  counter_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(128) NOT NULL DEFAULT '',
  value INT NOT NULL DEFAULT 0,
  window_start DATETIME NOT NULL,
  window_end DATETIME NOT NULL,
  synced_at DATETIME NOT NULL,
  UNIQUE KEY uq_counter_sync_window (counter_type, entity_id, window_start, window_end),
  KEY ix_counter_sync_snapshots_counter_type (counter_type),
  KEY ix_counter_sync_snapshots_entity_id (entity_id),
  KEY ix_counter_sync_snapshots_window_start (window_start),
  KEY ix_counter_sync_snapshots_window_end (window_end),
  KEY ix_counter_sync_snapshots_synced_at (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id VARCHAR(64) NULL,
  actor_ip VARCHAR(64) NOT NULL DEFAULT '',
  action VARCHAR(128) NOT NULL,
  target_type VARCHAR(64) NOT NULL DEFAULT '',
  target_id VARCHAR(128) NOT NULL DEFAULT '',
  payload_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY ix_security_audit_logs_actor_user_id (actor_user_id),
  KEY ix_security_audit_logs_actor_ip (actor_ip),
  KEY ix_security_audit_logs_action (action),
  KEY ix_security_audit_logs_target_type (target_type),
  KEY ix_security_audit_logs_target_id (target_id),
  KEY ix_security_audit_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS user_follows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  follower_user_id VARCHAR(64) NOT NULL,
  followed_user_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_user_follows_pair (follower_user_id, followed_user_id),
  KEY ix_user_follows_follower_user_id (follower_user_id),
  KEY ix_user_follows_followed_user_id (followed_user_id),
  KEY ix_user_follows_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS prompt_version_records (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  raw_prompt LONGTEXT NOT NULL,
  artistic_prompt LONGTEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  KEY ix_prompt_version_records_user_id (user_id),
  KEY ix_prompt_version_records_content_hash (content_hash),
  KEY ix_prompt_version_records_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS prompt_presets (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(64) NOT NULL DEFAULT '',
  prompt_hint LONGTEXT NOT NULL,
  params_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY ix_prompt_presets_user_id (user_id),
  KEY ix_prompt_presets_name (name),
  KEY ix_prompt_presets_category (category),
  KEY ix_prompt_presets_updated_at (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ------------------------------------------------------------
-- 2) Idempotent helper procedures for existing schema upgrades
-- ------------------------------------------------------------

DROP PROCEDURE IF EXISTS _inkai_add_column_if_missing;
DELIMITER $$
CREATE PROCEDURE _inkai_add_column_if_missing(
  IN p_table VARCHAR(64),
  IN p_column VARCHAR(64),
  IN p_sql LONGTEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND column_name = p_column
  ) THEN
    SET @ddl = p_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

DROP PROCEDURE IF EXISTS _inkai_add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE _inkai_add_index_if_missing(
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(128),
  IN p_sql LONGTEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = p_table
      AND index_name = p_index
  ) THEN
    SET @ddl = p_sql;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ------------------------------------------------------------
-- 3) forum_questions enhancements
-- ------------------------------------------------------------

CALL _inkai_add_column_if_missing(
  'forum_questions',
  'tags_json',
  'ALTER TABLE forum_questions ADD COLUMN tags_json LONGTEXT NULL'
);

CALL _inkai_add_column_if_missing(
  'forum_questions',
  'invited_user_ids_json',
  'ALTER TABLE forum_questions ADD COLUMN invited_user_ids_json LONGTEXT NULL'
);

CALL _inkai_add_index_if_missing(
  'forum_questions',
  'ix_forum_questions_mod_created',
  'CREATE INDEX ix_forum_questions_mod_created ON forum_questions (moderation_status, created_at)'
);

CALL _inkai_add_index_if_missing(
  'forum_questions',
  'ix_forum_questions_user_created',
  'CREATE INDEX ix_forum_questions_user_created ON forum_questions (user_id, created_at)'
);

CALL _inkai_add_index_if_missing(
  'forum_questions',
  'ix_forum_questions_solved_created',
  'CREATE INDEX ix_forum_questions_solved_created ON forum_questions (solved, created_at)'
);

CALL _inkai_add_index_if_missing(
  'forum_answers',
  'ix_forum_answers_question_created',
  'CREATE INDEX ix_forum_answers_question_created ON forum_answers (question_id, created_at)'
);

-- ------------------------------------------------------------
-- 4) image_generation_tasks queue fields
-- ------------------------------------------------------------

CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'status',
  'ALTER TABLE image_generation_tasks ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT ''completed'''
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'progress',
  'ALTER TABLE image_generation_tasks ADD COLUMN progress INT NOT NULL DEFAULT 0'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'failure_reason',
  'ALTER TABLE image_generation_tasks ADD COLUMN failure_reason LONGTEXT NULL'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'retry_count',
  'ALTER TABLE image_generation_tasks ADD COLUMN retry_count INT NOT NULL DEFAULT 0'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'max_retries',
  'ALTER TABLE image_generation_tasks ADD COLUMN max_retries INT NOT NULL DEFAULT 3'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'queue_message_id',
  'ALTER TABLE image_generation_tasks ADD COLUMN queue_message_id VARCHAR(64) NULL'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'queued_at',
  'ALTER TABLE image_generation_tasks ADD COLUMN queued_at DATETIME NULL'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'started_at',
  'ALTER TABLE image_generation_tasks ADD COLUMN started_at DATETIME NULL'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'finished_at',
  'ALTER TABLE image_generation_tasks ADD COLUMN finished_at DATETIME NULL'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'updated_at',
  'ALTER TABLE image_generation_tasks ADD COLUMN updated_at DATETIME NULL'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'paused',
  'ALTER TABLE image_generation_tasks ADD COLUMN paused TINYINT(1) NOT NULL DEFAULT 0'
);
CALL _inkai_add_column_if_missing(
  'image_generation_tasks',
  'cancelled',
  'ALTER TABLE image_generation_tasks ADD COLUMN cancelled TINYINT(1) NOT NULL DEFAULT 0'
);

CALL _inkai_add_index_if_missing(
  'image_generation_tasks',
  'ix_image_generation_tasks_status',
  'CREATE INDEX ix_image_generation_tasks_status ON image_generation_tasks (status)'
);
CALL _inkai_add_index_if_missing(
  'image_generation_tasks',
  'ix_image_generation_tasks_queue_message_id',
  'CREATE INDEX ix_image_generation_tasks_queue_message_id ON image_generation_tasks (queue_message_id)'
);
CALL _inkai_add_index_if_missing(
  'image_generation_tasks',
  'ix_image_generation_tasks_updated_at',
  'CREATE INDEX ix_image_generation_tasks_updated_at ON image_generation_tasks (updated_at)'
);
CALL _inkai_add_index_if_missing(
  'image_generation_tasks',
  'ix_image_generation_tasks_paused',
  'CREATE INDEX ix_image_generation_tasks_paused ON image_generation_tasks (paused)'
);
CALL _inkai_add_index_if_missing(
  'image_generation_tasks',
  'ix_image_generation_tasks_cancelled',
  'CREATE INDEX ix_image_generation_tasks_cancelled ON image_generation_tasks (cancelled)'
);

-- ------------------------------------------------------------
-- 5) high-frequency query indexes
-- ------------------------------------------------------------

CALL _inkai_add_index_if_missing(
  'community_posts',
  'ix_community_posts_mod_published',
  'CREATE INDEX ix_community_posts_mod_published ON community_posts (moderation_status, published_at)'
);
CALL _inkai_add_index_if_missing(
  'community_posts',
  'ix_community_posts_owner_created',
  'CREATE INDEX ix_community_posts_owner_created ON community_posts (owner_user_id, created_at)'
);

CALL _inkai_add_index_if_missing(
  'credit_ledger',
  'ix_credit_ledger_user_created',
  'CREATE INDEX ix_credit_ledger_user_created ON credit_ledger (user_id, created_at)'
);
CALL _inkai_add_index_if_missing(
  'credit_ledger',
  'ix_credit_ledger_user_type_created',
  'CREATE INDEX ix_credit_ledger_user_type_created ON credit_ledger (user_id, type, created_at)'
);

CALL _inkai_add_index_if_missing(
  'api_call_logs',
  'ix_api_call_logs_created_path',
  'CREATE INDEX ix_api_call_logs_created_path ON api_call_logs (created_at, path)'
);
CALL _inkai_add_index_if_missing(
  'api_call_logs',
  'ix_api_call_logs_status_created',
  'CREATE INDEX ix_api_call_logs_status_created ON api_call_logs (status_code, created_at)'
);

CALL _inkai_add_index_if_missing(
  'website_visit_logs',
  'ix_website_visit_logs_created_page',
  'CREATE INDEX ix_website_visit_logs_created_page ON website_visit_logs (created_at, page_path)'
);
CALL _inkai_add_index_if_missing(
  'website_visit_logs',
  'ix_website_visit_logs_visitor_created',
  'CREATE INDEX ix_website_visit_logs_visitor_created ON website_visit_logs (visitor_id, created_at)'
);

-- ------------------------------------------------------------
-- 6) moderation/export workflow tables
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS moderation_tickets (
  id VARCHAR(64) PRIMARY KEY,
  source VARCHAR(24) NOT NULL DEFAULT 'report',
  content_type VARCHAR(32) NOT NULL,
  content_id VARCHAR(64) NOT NULL,
  report_id VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  machine_result VARCHAR(24) NOT NULL DEFAULT 'review',
  machine_reason LONGTEXT NOT NULL,
  assigned_admin_user_id VARCHAR(64) NULL,
  assigned_admin_user_name VARCHAR(64) NOT NULL DEFAULT '',
  decision_reason LONGTEXT NOT NULL,
  appeal_reason LONGTEXT NOT NULL,
  final_result VARCHAR(24) NULL,
  created_by_user_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  claimed_at DATETIME NULL,
  decided_at DATETIME NULL,
  appealed_at DATETIME NULL,
  final_judged_at DATETIME NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_moderation_tickets_content_status (content_type, content_id, status),
  KEY ix_moderation_tickets_source (source),
  KEY ix_moderation_tickets_content_type (content_type),
  KEY ix_moderation_tickets_content_id (content_id),
  KEY ix_moderation_tickets_report_id (report_id),
  KEY ix_moderation_tickets_status (status),
  KEY ix_moderation_tickets_machine_result (machine_result),
  KEY ix_moderation_tickets_assigned_admin_user_id (assigned_admin_user_id),
  KEY ix_moderation_tickets_final_result (final_result),
  KEY ix_moderation_tickets_created_by_user_id (created_by_user_id),
  KEY ix_moderation_tickets_created_at (created_at),
  KEY ix_moderation_tickets_claimed_at (claimed_at),
  KEY ix_moderation_tickets_decided_at (decided_at),
  KEY ix_moderation_tickets_appealed_at (appealed_at),
  KEY ix_moderation_tickets_final_judged_at (final_judged_at),
  KEY ix_moderation_tickets_updated_at (updated_at),
  KEY ix_moderation_tickets_status_updated (status, updated_at),
  KEY ix_moderation_tickets_content_status_updated (content_type, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS moderation_ticket_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ticket_id VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  actor_user_id VARCHAR(64) NULL,
  actor_user_name VARCHAR(64) NOT NULL DEFAULT '',
  from_status VARCHAR(24) NOT NULL DEFAULT '',
  to_status VARCHAR(24) NOT NULL DEFAULT '',
  note LONGTEXT NOT NULL,
  meta_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  KEY ix_moderation_ticket_logs_ticket_id (ticket_id),
  KEY ix_moderation_ticket_logs_action (action),
  KEY ix_moderation_ticket_logs_actor_user_id (actor_user_id),
  KEY ix_moderation_ticket_logs_created_at (created_at),
  KEY ix_moderation_ticket_logs_ticket_created (ticket_id, created_at),
  CONSTRAINT fk_moderation_ticket_logs_ticket
    FOREIGN KEY (ticket_id) REFERENCES moderation_tickets(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS admin_export_tasks (
  id VARCHAR(64) PRIMARY KEY,
  request_user_id VARCHAR(64) NOT NULL,
  scope VARCHAR(24) NOT NULL DEFAULT 'all',
  file_format VARCHAR(16) NOT NULL DEFAULT 'xlsx',
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  progress INT NOT NULL DEFAULT 0,
  storage_path LONGTEXT NOT NULL,
  download_token VARCHAR(64) NOT NULL DEFAULT '',
  error LONGTEXT NOT NULL,
  file_size INT NOT NULL DEFAULT 0,
  params_json LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  KEY ix_admin_export_tasks_request_user_id (request_user_id),
  KEY ix_admin_export_tasks_scope (scope),
  KEY ix_admin_export_tasks_status (status),
  KEY ix_admin_export_tasks_download_token (download_token),
  KEY ix_admin_export_tasks_created_at (created_at),
  KEY ix_admin_export_tasks_started_at (started_at),
  KEY ix_admin_export_tasks_finished_at (finished_at),
  KEY ix_admin_export_tasks_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ------------------------------------------------------------
-- 7) Cleanup helper procedures
-- ------------------------------------------------------------

DROP PROCEDURE IF EXISTS _inkai_add_column_if_missing;
DROP PROCEDURE IF EXISTS _inkai_add_index_if_missing;
