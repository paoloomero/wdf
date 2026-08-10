// T18.2: until @wdf/import takes the conversion seat (T18.4), the
// background answers a capture with this observable diagnostic — the
// artifact Paolo can inspect in field tests to judge capture quality.
import type { CaptureRequest } from './protocol.js';

export interface CaptureDiagnostic {
  wdfCaptureDiagnostic: '0.1';
  provenance: CaptureRequest['provenance'];
  page: { title: string; lang: string; baseUrl: string; snapshotBytes: number };
  geometry: {
    documentSize: { width: number; height: number };
    elements: number;
    hidden: number;
    fixedOrSticky: number;
  };
  stylesheets: { href: string; origin: string; bytes: number }[];
  images: { url: string; origin: string; mediaType: string; bytes: number }[];
  report: string[];
}

export function buildDiagnostic(request: CaptureRequest): CaptureDiagnostic {
  const elements = request.geometry.elements;
  return {
    wdfCaptureDiagnostic: '0.1',
    provenance: request.provenance,
    page: {
      title: request.snapshot.title,
      lang: request.snapshot.lang,
      baseUrl: request.snapshot.baseUrl,
      snapshotBytes: new TextEncoder().encode(request.snapshot.html).length,
    },
    geometry: {
      documentSize: request.geometry.document,
      elements: elements.length,
      hidden: elements.filter((e) => e.display === 'none' || e.visibility === 'hidden').length,
      fixedOrSticky: elements.filter((e) => e.position === 'fixed' || e.position === 'sticky')
        .length,
    },
    stylesheets: request.stylesheets.map((s) => ({
      href: s.href,
      origin: s.origin,
      bytes: new TextEncoder().encode(s.css).length,
    })),
    images: request.images.map((i) => ({
      url: i.url,
      origin: i.origin,
      mediaType: i.mediaType,
      bytes: Math.floor((i.base64.length * 3) / 4),
    })),
    report: request.report,
  };
}
