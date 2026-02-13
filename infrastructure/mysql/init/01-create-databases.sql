-- Create test database for integration tests
CREATE DATABASE IF NOT EXISTS myfinpro_test;
GRANT ALL PRIVILEGES ON myfinpro_test.* TO 'myfinpro_user'@'%';
FLUSH PRIVILEGES;
