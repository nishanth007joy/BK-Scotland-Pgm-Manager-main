-- Existing rows with an unknown scorer must be resaved by a signed-in user.
-- WITH NOCHECK preserves those rows while rejecting future writes without a scorer.
IF OBJECT_ID('dbo.CK_PrePubResults_ScoreLastEditedBy', 'C') IS NULL
    ALTER TABLE dbo.PrePubResults WITH NOCHECK
      ADD CONSTRAINT CK_PrePubResults_ScoreLastEditedBy
      CHECK (ScoreLastEditedBy IS NOT NULL AND LEN(LTRIM(RTRIM(ScoreLastEditedBy))) > 0);
