# Live chat against the real providers

Run 2026-11-20T09:26:55.264Z on http://localhost:3100. Nothing failed.

| Provider | Widget ID | Step | Result | Detail |
|---|---|---|---|---|
| tawk | sample ID | nothing loads before cookies are accepted | ok | no request to the provider |
| tawk | sample ID | provider's script loads from its servers | not checked | the chat started and reached embed.tawk.to, which refused the sample ID; needs your real widget ID as a GitHub secret |
| tawk | sample ID | security policy allows it | ok | no blocked requests |
| tawk | sample ID | widget starts | not checked | not checked: needs your real widget ID as a GitHub secret |
| crisp | sample ID | nothing loads before cookies are accepted | ok | no request to the provider |
| crisp | sample ID | provider's script loads from its servers | ok | client.crisp.chat answered 200 |
| crisp | sample ID | security policy allows it | ok | no blocked requests |
| crisp | sample ID | widget starts | not checked | not checked: needs your real widget ID as a GitHub secret |
| tidio | sample ID | nothing loads before cookies are accepted | ok | no request to the provider |
| tidio | sample ID | provider's script loads from its servers | not checked | the chat started and reached code.tidio.co, which refused the sample ID; needs your real widget ID as a GitHub secret |
| tidio | sample ID | security policy allows it | ok | no blocked requests |
| tidio | sample ID | widget starts | not checked | not checked: needs your real widget ID as a GitHub secret |
| intercom | sample ID | nothing loads before cookies are accepted | ok | no request to the provider |
| intercom | sample ID | provider's script loads from its servers | ok | widget.intercom.io answered 200 |
| intercom | sample ID | security policy allows it | ok | no blocked requests |
| intercom | sample ID | widget starts | not checked | not checked: needs your real widget ID as a GitHub secret |
