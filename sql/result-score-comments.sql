-- Keep every score correction without truncating previous comments.
IF COL_LENGTH('dbo.PrePubResults', 'Comments') IS NULL
    ALTER TABLE dbo.PrePubResults ADD Comments nvarchar(max) NULL;
ELSE
    ALTER TABLE dbo.PrePubResults ALTER COLUMN Comments nvarchar(max) NULL;
