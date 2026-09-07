-- Documents: store the extracted text, not the original bytes.
--
-- The original file is deliberately not retained. The extracted text is what
-- source spans quote and what the confirmation screen shows, so keeping the
-- bytes as well would mean a blob store, signed URLs, and a second copy of an
-- organisation's private documents to secure and eventually lose. Storing
-- less is the stronger position, and it is also the one that deploys.
--
-- So storage_key becomes nullable: there is no key when there is no blob.

ALTER TABLE documents ALTER COLUMN storage_key DROP NOT NULL;

-- Where the ingest run got to. 'pending' exists so a row is never orphaned
-- between upload and extraction; a document stuck there is visible rather
-- than silently absent.
CREATE TYPE extraction_state AS ENUM ('pending', 'extracted', 'failed');

ALTER TABLE documents
  ADD COLUMN extraction_state extraction_state NOT NULL DEFAULT 'pending',
  -- Shown to the user. Never a stack trace.
  ADD COLUMN extraction_note text,
  -- Null for formats with no fixed pages, such as .docx.
  ADD COLUMN page_count integer,
  ADD COLUMN character_count integer,
  -- True when the document was longer than we were willing to read, so the
  -- interface can say so instead of implying it read the whole thing.
  ADD COLUMN truncated boolean NOT NULL DEFAULT false,
  -- Text that addressed the model rather than describing the organisation.
  -- Surfaced to the user: an injection attempt is a signal about the
  -- document, not something to swallow quietly.
  ADD COLUMN instruction_like_content text[] NOT NULL DEFAULT '{}',
  ADD COLUMN extracted_at timestamptz;

ALTER TABLE documents
  ADD CONSTRAINT extracted_documents_record_when
    CHECK (extraction_state <> 'extracted' OR extracted_at IS NOT NULL),
  ADD CONSTRAINT failed_documents_say_why
    CHECK (extraction_state <> 'failed' OR extraction_note IS NOT NULL),
  ADD CONSTRAINT page_count_is_positive
    CHECK (page_count IS NULL OR page_count > 0);

CREATE INDEX documents_state_idx ON documents (organisation_id, extraction_state);
