-- Run this on the MySQL DB before activating the updated workflow 01
-- Adds conversationid column so email threads can be matched to existing complaints

ALTER TABLE vmm_complaints ADD COLUMN conversationid VARCHAR(500) DEFAULT NULL;
ALTER TABLE vmm_complaints ADD INDEX idx_conversationid (conversationid(255));
