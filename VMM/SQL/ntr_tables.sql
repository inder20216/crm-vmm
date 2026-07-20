-- VMM Non-Trading Request Tables
-- Run once on your MySQL database before importing the NTR workflows.

CREATE TABLE IF NOT EXISTS vmm_ntr_requests (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  store_code       VARCHAR(20)  NOT NULL DEFAULT '',
  store_name       VARCHAR(100) NOT NULL DEFAULT '',
  request_date     VARCHAR(20)  NOT NULL DEFAULT '',
  received_date    VARCHAR(20)  NOT NULL DEFAULT '',
  email_from       VARCHAR(200) NOT NULL DEFAULT '',
  email_subject    TEXT,
  email_message_id VARCHAR(500) NOT NULL DEFAULT '',
  status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
  total_items      INT          NOT NULL DEFAULT 0,
  escalated_at     DATETIME     NULL,
  escalated_to     VARCHAR(200) NOT NULL DEFAULT '',
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vmm_ntr_items (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  request_id         INT         NOT NULL,
  item_article_no    VARCHAR(50)  NOT NULL DEFAULT '',
  item_name          VARCHAR(255) NOT NULL DEFAULT '',
  last_received_date VARCHAR(20)  NOT NULL DEFAULT '',
  last_received_qty  VARCHAR(50)  NOT NULL DEFAULT '',
  current_stock      VARCHAR(50)  NOT NULL DEFAULT '',
  stock_days         VARCHAR(50)  NOT NULL DEFAULT '',
  store_requirement  VARCHAR(50)  NOT NULL DEFAULT '',
  ho_recommendation  VARCHAR(255) NOT NULL DEFAULT '',
  CONSTRAINT fk_ntr_request FOREIGN KEY (request_id)
    REFERENCES vmm_ntr_requests(id) ON DELETE CASCADE
);
