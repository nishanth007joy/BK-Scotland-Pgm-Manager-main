SET XACT_ABORT ON;
BEGIN TRANSACTION;
BEGIN TRY
    IF COL_LENGTH('dbo.PrePubResults', 'ScoreLastEditedBy') IS NULL
        ALTER TABLE dbo.PrePubResults ADD ScoreLastEditedBy nvarchar(255) NULL;
    IF OBJECT_ID('dbo.CK_PrePubResults_ScoreLastEditedBy', 'C') IS NULL
        ALTER TABLE dbo.PrePubResults WITH NOCHECK
            ADD CONSTRAINT CK_PrePubResults_ScoreLastEditedBy
            CHECK (ScoreLastEditedBy IS NOT NULL AND LEN(LTRIM(RTRIM(ScoreLastEditedBy))) > 0);

    -- Existing scores have no known scorer. Identify their scorer before approval.
    IF OBJECT_ID('dbo.PublishedResults', 'U') IS NULL
        CREATE TABLE dbo.PublishedResults (
            EventID nvarchar(50) NOT NULL,
            EventName varchar(50) NOT NULL,
            EventAgeGroup nvarchar(50) NOT NULL,
            IndividualGroup char(10) NOT NULL,
            OnStageOffStage char(10) NOT NULL,
            ContestantID nvarchar(50) NOT NULL,
            ContestantFirstName varchar(50) NOT NULL,
            ContestantLastName varchar(50) NOT NULL,
            ContestantMission varchar(50) NOT NULL,
            ChestNo nchar(10) NOT NULL,
            Score decimal(12,2) NOT NULL,
            Place varchar(6) NOT NULL,
            Points int NOT NULL,
            ScoreLastEditedBy nvarchar(255) NOT NULL,
            ApprovedBy nvarchar(255) NOT NULL,
            ApprovedAt datetime2(0) NOT NULL,
            CertificatePrinted varchar(3) NOT NULL
                CONSTRAINT DF_PublishedResults_CertificatePrinted DEFAULT ('No'),
            CONSTRAINT PK_PublishedResults PRIMARY KEY (EventID, ContestantID),
            CONSTRAINT CK_PublishedResults_Place CHECK (Place IN ('First', 'Second', 'Third')),
            CONSTRAINT CK_PublishedResults_Points CHECK (Points >= 0),
            CONSTRAINT CK_PublishedResults_CertificatePrinted CHECK (CertificatePrinted IN ('Yes', 'No'))
        );
    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;
