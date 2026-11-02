import { describe, expect, it } from 'vitest';
import { s3Artifacts, type S3ArtifactsOptions } from '../../src/artifacts/s3Artifacts.js';

function captureClient() {
  const configs: unknown[] = [];
  class Command {
    constructor(readonly input: unknown) {}
  }
  return {
    configs,
    sdk: {
      S3Client: class {
        constructor(config: unknown) {
          configs.push(config);
        }
        async send(): Promise<unknown> {
          return {};
        }
      },
      PutObjectCommand: Command,
      GetObjectCommand: Command,
      HeadObjectCommand: Command,
      DeleteObjectCommand: Command,
      ListObjectsV2Command: Command,
    },
  };
}

describe('S3-compatible artifact endpoint', () => {
  it('does not expose SDK constructor failure text', () => {
    const capture = captureClient();
    const sdk = {
      ...capture.sdk,
      S3Client: class {
        constructor() {
          throw new Error('PRIVATE_CONSTRUCTOR_SENTINEL');
        }
        async send(): Promise<unknown> {
          return {};
        }
      },
    };
    let failure: unknown;
    try {
      s3Artifacts({ bucket: 'artifacts', _sdk: sdk });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'S3ArtifactsConfigurationError',
      code: 'ERR_S3_ARTIFACTS_CONFIGURATION',
      reason: 'client-construction-failed',
    });
    expect(failure).not.toHaveProperty('cause');
    expect(String(failure)).not.toContain('PRIVATE_CONSTRUCTOR_SENTINEL');
  });
  it('passes the declared endpoint to an owned SDK client without changing it', () => {
    const capture = captureClient();
    // The cast keeps the unchanged baseline runnable: an absent type member is
    // not the regression proof. The SDK construction below must receive it.
    const options = {
      bucket: 'artifacts',
      region: 'us-east-1',
      endpoint: 'https://objects.example.test:9000/custom',
      forcePathStyle: true,
      _sdk: capture.sdk,
    } as S3ArtifactsOptions;
    s3Artifacts(options);
    expect(capture.configs).toEqual([
      {
        region: 'us-east-1',
        endpoint: 'https://objects.example.test:9000/custom',
        forcePathStyle: true,
      },
    ]);
  });

  it('keeps the SDK default when no endpoint is declared', () => {
    const capture = captureClient();
    s3Artifacts({ bucket: 'artifacts', _sdk: capture.sdk });
    expect(capture.configs).toEqual([{}]);
  });

  it('forwards an explicit false addressing option', () => {
    const capture = captureClient();
    s3Artifacts({
      bucket: 'artifacts',
      forcePathStyle: false,
      _sdk: capture.sdk,
    } as S3ArtifactsOptions);
    expect(capture.configs).toEqual([{ forcePathStyle: false }]);
  });

  it.each([
    { region: 'unused-region' },
    { endpoint: 'https://unused.example.test' },
    { forcePathStyle: true },
    { forcePathStyle: false },
  ])('refuses client construction options beside an injected client: %j', (configuration) => {
    const capture = captureClient();
    let failure: unknown;
    try {
      s3Artifacts({
        bucket: 'artifacts',
        client: { send: async () => ({}) },
        _sdk: capture.sdk,
        ...configuration,
      } as S3ArtifactsOptions);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      name: 'S3ArtifactsConfigurationError',
      code: 'ERR_S3_ARTIFACTS_CONFIGURATION',
      reason: 'conflicting-options',
    });
    expect(capture.configs).toEqual([]);
  });
});
