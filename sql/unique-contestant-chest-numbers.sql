-- Preserve existing records and enforce uniqueness for inserted or updated rows.
-- Numbers are unique within each stage, and may be reused across different stages.
CREATE OR ALTER TRIGGER dbo.TR_Contestants_UniqueChestNumbers
ON dbo.Contestants
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM inserted) RETURN;
    IF EXISTS (
        SELECT 1
        FROM inserted AS i
        JOIN dbo.Contestants AS c WITH (UPDLOCK, HOLDLOCK)
          ON c.ID <> i.ID
         AND NULLIF(LTRIM(RTRIM(c.OnStageChestNo)), '') = NULLIF(LTRIM(RTRIM(i.OnStageChestNo)), '')
    )
        THROW 51062, 'On-stage chest number already belongs to another contestant. Enter a unique on-stage chest number.', 1;

    IF EXISTS (
        SELECT 1
        FROM inserted AS i
        JOIN dbo.Contestants AS c WITH (UPDLOCK, HOLDLOCK)
          ON c.ID <> i.ID
         AND NULLIF(LTRIM(RTRIM(c.OffStageChestNo)), '') = NULLIF(LTRIM(RTRIM(i.OffStageChestNo)), '')
    )
        THROW 51062, 'Off-stage chest number already belongs to another contestant. Enter a unique off-stage chest number.', 1;
END;
