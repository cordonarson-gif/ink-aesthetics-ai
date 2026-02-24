-- Time-series monthly partition plan for MySQL 8.0+
-- Tables:
--   - api_call_logs
--   - website_visit_logs
--
-- Important:
-- 1) MySQL requires every UNIQUE/PRIMARY KEY to include the partition key.
-- 2) Existing tables use PRIMARY KEY(id), so direct partitioning is not valid.
-- 3) This script creates partitioned shadow tables and provides rename cutover SQL.

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1) Partitioned shadow table: api_call_logs_p
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS api_call_logs_p (
  id BIGINT NOT NULL AUTO_INCREMENT,
  method VARCHAR(16) NOT NULL,
  path VARCHAR(255) NOT NULL,
  status_code INT NOT NULL,
  latency_ms INT NOT NULL DEFAULT 0,
  success TINYINT(1) NOT NULL DEFAULT 1,
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  user_id VARCHAR(64) NULL,
  error_detail LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id, created_at),
  KEY ix_api_call_logs_method (method),
  KEY ix_api_call_logs_path (path),
  KEY ix_api_call_logs_status_code (status_code),
  KEY ix_api_call_logs_success (success),
  KEY ix_api_call_logs_user_id (user_id),
  KEY ix_api_call_logs_created_at (created_at),
  KEY ix_api_call_logs_created_path (created_at, path),
  KEY ix_api_call_logs_status_created (status_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
PARTITION BY RANGE COLUMNS(created_at) (
  PARTITION p202601 VALUES LESS THAN ('2026-02-01'),
  PARTITION p202602 VALUES LESS THAN ('2026-03-01'),
  PARTITION pmax VALUES LESS THAN (MAXVALUE)
);

-- ------------------------------------------------------------
-- 2) Partitioned shadow table: website_visit_logs_p
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS website_visit_logs_p (
  id BIGINT NOT NULL AUTO_INCREMENT,
  visitor_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NULL,
  page_path VARCHAR(255) NOT NULL,
  source_channel VARCHAR(64) NOT NULL DEFAULT 'direct',
  referrer LONGTEXT NOT NULL,
  terminal_type VARCHAR(32) NOT NULL DEFAULT 'unknown',
  region VARCHAR(64) NOT NULL DEFAULT 'Unknown',
  client_ip VARCHAR(64) NOT NULL DEFAULT '',
  user_agent LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id, created_at),
  KEY ix_website_visit_logs_visitor_id (visitor_id),
  KEY ix_website_visit_logs_session_id (session_id),
  KEY ix_website_visit_logs_user_id (user_id),
  KEY ix_website_visit_logs_page_path (page_path),
  KEY ix_website_visit_logs_source_channel (source_channel),
  KEY ix_website_visit_logs_created_at (created_at),
  KEY ix_website_visit_logs_created_page (created_at, page_path),
  KEY ix_website_visit_logs_visitor_created (visitor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
PARTITION BY RANGE COLUMNS(created_at) (
  PARTITION p202601 VALUES LESS THAN ('2026-02-01'),
  PARTITION p202602 VALUES LESS THAN ('2026-03-01'),
  PARTITION pmax VALUES LESS THAN (MAXVALUE)
);

-- ------------------------------------------------------------
-- 3) One-time data migration (optional, maintenance window)
-- ------------------------------------------------------------
-- INSERT INTO api_call_logs_p (
--   id, method, path, status_code, latency_ms, success, client_ip, user_id, error_detail, created_at
-- )
-- SELECT
--   id, method, path, status_code, latency_ms, success, client_ip, user_id, error_detail, created_at
-- FROM api_call_logs;
--
-- INSERT INTO website_visit_logs_p (
--   id, visitor_id, session_id, user_id, page_path, source_channel, referrer,
--   terminal_type, region, client_ip, user_agent, created_at
-- )
-- SELECT
--   id, visitor_id, session_id, user_id, page_path, source_channel, referrer,
--   terminal_type, region, client_ip, user_agent, created_at
-- FROM website_visit_logs;
--
-- ALTER TABLE api_call_logs RENAME TO api_call_logs_bak;
-- ALTER TABLE api_call_logs_p RENAME TO api_call_logs;
-- ALTER TABLE website_visit_logs RENAME TO website_visit_logs_bak;
-- ALTER TABLE website_visit_logs_p RENAME TO website_visit_logs;

-- ------------------------------------------------------------
-- 4) Monthly partition maintenance procedure/event
-- ------------------------------------------------------------

DROP PROCEDURE IF EXISTS sp_add_next_month_partition;
DELIMITER $$
CREATE PROCEDURE sp_add_next_month_partition(IN p_table_name VARCHAR(64))
BEGIN
  DECLARE v_next_first DATE;
  DECLARE v_next_next_first DATE;
  DECLARE v_partition_name VARCHAR(32);
  DECLARE v_exists INT DEFAULT 0;

  SET v_next_first = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01');
  SET v_next_next_first = DATE_FORMAT(DATE_ADD(v_next_first, INTERVAL 1 MONTH), '%Y-%m-01');
  SET v_partition_name = DATE_FORMAT(v_next_first, 'p%Y%m');

  SELECT COUNT(1)
    INTO v_exists
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = p_table_name
    AND partition_name = v_partition_name;

  IF v_exists = 0 THEN
    SET @ddl = CONCAT(
      'ALTER TABLE ', p_table_name,
      ' REORGANIZE PARTITION pmax INTO (',
      'PARTITION ', v_partition_name, ' VALUES LESS THAN (''', v_next_next_first, '''),',
      'PARTITION pmax VALUES LESS THAN (MAXVALUE))'
    );
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS ev_add_log_partitions;
CREATE EVENT ev_add_log_partitions
ON SCHEDULE EVERY 1 MONTH
STARTS TIMESTAMP(CURRENT_DATE) + INTERVAL 1 DAY
DO
BEGIN
  CALL sp_add_next_month_partition('api_call_logs');
  CALL sp_add_next_month_partition('website_visit_logs');
END;

-- ------------------------------------------------------------
-- 5) Query pruning guidance
-- ------------------------------------------------------------
-- Always query by bounded created_at range to trigger partition pruning:
--   WHERE created_at >= '2026-02-01' AND created_at < '2026-03-01'
