# Releasing

GitHub Releases are published to npm by the `Publish to npm` workflow. The release tag must match the version in `package.json`, with an optional `v` prefix (for example, package version `2.7.6` and tag `v2.7.6`). Stable releases use the npm `latest` dist-tag; GitHub prereleases use `next`.

The `Test` workflow runs on pull requests and pushes to `master`. It is also called by the release workflow, which waits for the test matrix on Node.js 22 and 24 to pass before publishing. `npm test` enforces at least 80% line, 70% branch, and 75% function coverage.

## One-time npm setup

npm only lets a Trusted Publisher be added to a package that already exists, so the first release is published with a token. Create an npm granular access token with read and write access to the `@evilbunny` scope and save it as the `NPM_TOKEN` repository secret. Once the package is on npm, add the Trusted Publisher below, then remove the `NODE_AUTH_TOKEN` env from the publish steps and delete the secret.

In the npm settings for `@evilbunny/node-red-contrib-zigbee2mqtt`, add a Trusted Publisher with:

- Provider: GitHub Actions
- Organization or user: `evilbunny2008`
- Repository: `node-red-contrib-zigbee2mqtt`
- Workflow filename: `publish-npm.yml`
- Environment: leave blank
- Allowed actions: enable direct `npm publish`

The package's `repository.url` is set to the canonical GitHub repository URL for this publisher configuration. Trusted publishing uses GitHub's OIDC identity, so no npm token needs to be stored in GitHub Secrets. npm requires the first successful publish to validate a new Trusted Publisher configuration within two days of creating it.

## Publish a release

1. Update the version in `package.json` and `package-lock.json`.
2. Create a GitHub Release using the matching tag, such as `v2.7.6`.
3. Publish the release. The workflow runs the test matrix, checks the tag against the package version, checks the package contents, and publishes it to npm.

See [npm's Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/) for setup details.
