// GENERATED FILE — do not edit. Source of truth: spec/schemas/*.json.
// Regenerate with: pnpm sync:schemas

export const manifestSchema: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/0.1/manifest.schema.json',
  title: 'WDF Core 0.1 — manifest.json',
  description: 'Package manifest, at the root of every .wdf archive (WDF Core 0.1 §manifest).',
  type: 'object',
  additionalProperties: false,
  required: ['wdf', 'id', 'title', 'language', 'created', 'modified', 'entry'],
  properties: {
    wdf: {
      description: 'Version of the WDF Core spec the package conforms to.',
      const: '0.1',
    },
    id: {
      description:
        'Stable document identifier (URN UUID). Used as the authority part of wdf: citation URIs.',
      type: 'string',
      pattern: '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    },
    title: {
      type: 'string',
      minLength: 1,
    },
    language: {
      description: 'Primary language of the document (BCP 47).',
      type: 'string',
      pattern: '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$',
    },
    authors: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
          },
          role: {
            type: 'string',
            minLength: 1,
          },
        },
      },
    },
    created: {
      type: 'string',
      format: 'date-time',
    },
    modified: {
      type: 'string',
      format: 'date-time',
    },
    entry: {
      description: 'Entry document. Fixed in WDF Core 0.1.',
      const: 'content/index.html',
    },
    resources: {
      description:
        'Every package resource other than the required files. Paths are package-relative; path segments start with an alphanumeric character (no dotfiles, no traversal).',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'mediaType'],
        properties: {
          path: {
            type: 'string',
            pattern: '^(content|data)(/[A-Za-z0-9][A-Za-z0-9._-]*)+$',
          },
          mediaType: {
            type: 'string',
            pattern: '^[a-z]+/[A-Za-z0-9.+-]+$',
          },
        },
      },
    },
    datasets: {
      description: 'Typed datasets under data/, referenced by tables via data-wdf-dataset.',
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'schema'],
        properties: {
          path: {
            type: 'string',
            pattern: '^data(/[A-Za-z0-9][A-Za-z0-9._-]*)+\\.json$',
          },
          title: {
            type: 'string',
            minLength: 1,
          },
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['columns'],
            properties: {
              columns: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['name', 'type'],
                  properties: {
                    name: {
                      type: 'string',
                      minLength: 1,
                    },
                    type: {
                      enum: ['string', 'integer', 'number', 'boolean', 'date'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    extensions: {
      description:
        'Versioned extensions used by this document. Empty in WDF Core 0.1; extension content is outside the core spec.',
      type: 'array',
      items: {
        type: 'object',
        required: ['name'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
          },
          version: {
            type: 'string',
            minLength: 1,
          },
        },
      },
    },
  },
};

export const outlineSchema: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/0.1/outline.schema.json',
  title: 'WDF Core 0.1 — ai/outline.json',
  description:
    'Ordered structure map of the document: one node per citable element, in document order (WDF Core 0.1 §ai-layer). Node ids MUST be unique and MUST match the id attributes in content/index.html; uniqueness and cross-references are enforced by the validator, not by this schema.',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'type', 'parent'],
    properties: {
      id: {
        description:
          'Stable element id: type prefix + slug or counter (e.g. sec-introduction, p-0012, tbl-spesa-2025).',
        type: 'string',
        pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$',
      },
      type: {
        enum: ['section', 'heading', 'paragraph', 'table', 'figure', 'blockquote', 'list-item'],
      },
      level: {
        description: 'Heading level; present if and only if type is "heading".',
        type: 'integer',
        minimum: 1,
        maximum: 6,
      },
      title: {
        type: 'string',
        minLength: 1,
      },
      parent: {
        description: 'id of the containing node, or null for top-level nodes.',
        oneOf: [
          {
            type: 'null',
          },
          {
            type: 'string',
            pattern: '^[a-z]+-[a-z0-9][a-z0-9-]*$',
          },
        ],
      },
    },
    if: {
      properties: {
        type: {
          const: 'heading',
        },
      },
      required: ['type'],
    },
    then: {
      required: ['level'],
    },
    else: {
      not: {
        required: ['level'],
      },
    },
  },
};

export const hashesSchema: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/0.1/hashes.schema.json',
  title: 'WDF Core 0.1 — integrity/hashes.json',
  description:
    'SHA-256 digest of every file in the package except integrity/hashes.json itself (WDF Core 0.1 §integrity). The key pattern excludes the integrity/ directory, which contains only this file.',
  type: 'object',
  additionalProperties: false,
  required: ['algorithm', 'files'],
  properties: {
    algorithm: {
      const: 'sha256',
    },
    files: {
      type: 'object',
      minProperties: 1,
      propertyNames: {
        pattern: '^(manifest\\.json|(content|data|ai|ext)(/[A-Za-z0-9][A-Za-z0-9._-]*)+)$',
      },
      additionalProperties: {
        description: 'Lowercase hex SHA-256 digest.',
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
      },
    },
  },
};

export const captureSchema: object = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wdf.dev/schemas/ext/capture/0.1/capture.schema.json',
  title: 'WDF extension `capture` 0.1 — capture.json',
  description:
    'Provenance metadata of a live-page capture (docs/ext-capture.md §4). An extension schema, not part of WDF Core.',
  type: 'object',
  additionalProperties: false,
  required: ['capture', 'url', 'capturedAt', 'userAgent', 'viewport', 'mode'],
  properties: {
    capture: {
      description: 'Version of the capture extension the file conforms to.',
      const: '0.1',
    },
    url: {
      description: 'Page address at capture time (http/https only).',
      type: 'string',
      pattern: '^https?://[^\\s<>]+$',
    },
    capturedAt: {
      description: 'Capture instant (RFC 3339 date-time).',
      type: 'string',
      format: 'date-time',
    },
    userAgent: {
      description: 'User agent string of the capturing browser.',
      type: 'string',
      minLength: 1,
    },
    viewport: {
      description: 'Layout viewport at capture time (CSS pixels).',
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: {
          type: 'integer',
          minimum: 1,
        },
        height: {
          type: 'integer',
          minimum: 1,
        },
        devicePixelRatio: {
          type: 'number',
          exclusiveMinimum: 0,
        },
      },
    },
    mode: {
      description: 'What was captured: the extracted article or the whole page.',
      enum: ['article', 'full-page'],
    },
  },
};
