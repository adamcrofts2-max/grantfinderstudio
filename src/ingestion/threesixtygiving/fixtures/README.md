# Fixtures

**All data in this directory is fictional.** The funders, recipients and grants
named here do not exist. No value is real data and none of it may be presented
as a real funding opportunity.

## The shape is the API's, not the Standard's

These files used to carry each grant at the top level of `results`, because they
were written from the 360Giving Data **Standard**. The API does not send that:
`GrantSerializer` wraps the standard record in `data` and puts `data_license`,
`publisher`, `funders` and `recipients` beside it. So the ingest was handing the
wrapper to the normaliser and would have rejected every real grant as having no
id, no currency and no date — and these fixtures made the tests agree with it.

They now carry the envelope. A fixture written from a specification is a guess
about a service; the envelope here is read from `ThreeSixtyGiving/datastore` at
`4a57c2e` (`api/org/serializers.py`).

Live verification against `https://api.threesixtygiving.org/api/v1/` still has
not been done: the build environment's egress allowlist blocks that host. What
HAS been done is reading their source, which is how the wrong shape was found.
