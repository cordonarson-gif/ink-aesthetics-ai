-- 修改账号和密码后执行：mysql -uroot -p < scripts/mysql-init.sql
CREATE DATABASE IF NOT EXISTS inkai
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'inkai_user'@'localhost' IDENTIFIED BY 'ChangeMe_StrongPassword_123';
GRANT ALL PRIVILEGES ON inkai.* TO 'inkai_user'@'localhost';
FLUSH PRIVILEGES;
