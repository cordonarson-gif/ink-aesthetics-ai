-- Notification system extension DDL
-- Target: MySQL 8.0+
-- Mode: Incremental / idempotent

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(200) NOT NULL,
  content LONGTEXT NOT NULL,
  related_id VARCHAR(64) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  KEY ix_notifications_user_id (user_id),
  KEY ix_notifications_type (type),
  KEY ix_notifications_related_id (related_id),
  KEY ix_notifications_is_read (is_read),
  KEY ix_notifications_created_at (created_at),
  KEY ix_notifications_user_read_created (user_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
