# Vendor Icon Refresh

This project vendors icon assets from `homarr-labs/dashboard-icons` into:

- `static/icons/vendor/homarr/`

After refreshing the vendored files, regenerate the searchable manifest:

```bash
pnpm run icons:manifest
```

Then verify:

- `src/lib/config/vendorIconManifest.ts` changed as expected
- `third_party/homarr-dashboard-icons/SOURCE.txt` has the new upstream commit/date
- `third_party/homarr-dashboard-icons/LICENSE` still matches upstream
