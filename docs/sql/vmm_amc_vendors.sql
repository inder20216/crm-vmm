-- =============================================================================
-- VMM CRM — Dedicated store-wise AMC vendor table
-- =============================================================================
-- Only three service types are allowed: AC AMC, Lift AMC, Pest Control AMC.
-- The ENUM below is the guard rail — no other AMC/service type can be stored.
-- Table prefix follows the rest of the VMM schema (vmm_).
-- =============================================================================

CREATE TABLE IF NOT EXISTS `vmm_amc_vendors` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `store_code`   VARCHAR(20)  NOT NULL                COMMENT 'Store code, e.g. HV24. Use ALL for HO-wide cover',
  `store_name`   VARCHAR(150)     NULL                COMMENT 'Optional display name',
  `service_type` ENUM('AC AMC', 'Lift AMC', 'Pest Control AMC') NOT NULL,
  `vendor_name`  VARCHAR(200) NOT NULL                COMMENT 'Vendor / contractor name',
  `vendor_email` VARCHAR(255)     NULL,
  `vendor_phone` VARCHAR(100)     NULL,
  `is_active`    TINYINT(1)   NOT NULL DEFAULT 1,
  `remarks`      VARCHAR(500)     NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_amc_store_service` (`store_code`, `service_type`),
  KEY `idx_amc_service` (`service_type`, `is_active`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Store-wise AMC vendors — AC, Lift and Pest Control only';

-- -----------------------------------------------------------------------------
-- Seed data (1995 rows) from "VMM all data - July 2025 (4).xlsx":
--   docs/sql/vmm_amc_vendors_seed.sql
-- Source sheets: AC AMC List (762), Lift vendor store (406),
--                PestVendor-Store wise (827).
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- Read query used by the AMC Vendors page (currently seeded locally — no webhook)
-- -----------------------------------------------------------------------------
-- SELECT store_code, store_name, service_type, vendor_name, vendor_email
-- FROM   vmm_amc_vendors
-- WHERE  is_active = 1
--   AND  service_type IN ('AC AMC', 'Lift AMC', 'Pest Control AMC')
-- ORDER  BY service_type, store_code;

-- To allow a new service type later:
-- ALTER TABLE vmm_amc_vendors
--   MODIFY service_type ENUM('AC AMC', 'Lift AMC', 'Pest Control AMC', 'NEW TYPE') NOT NULL;
