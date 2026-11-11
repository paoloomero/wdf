# Field test: 16 public `.docx` files from Italian public bodies

What the `.docx` importer does on real documents it was not written against, and what it loses. Run on 11 November 2026.

**A valid package is not a faithful one.** Every document below validates; that says the output is well-formed WDF, not that it carries everything the Word file did. This page measures the second thing.

## Method

- **Corpus:** 16 `.docx` files published by 14 Italian public bodies (authorities, ministries, regions, a province, a municipality), downloaded from the public addresses listed at the end. Templates and normative texts; no filled-in forms. The files are not redistributed here.
- **Conversion:** the importer of this repository, with the original embedded (extension `source`).
- **Text measure:** the words of the source — body, footnotes and endnotes; a text box counted once — compared as a multiset with the words of `ai/content.md`. A word of the source that is not in the AI layer counts as missing, whatever the reason. Word's table of contents, dropped by rule (spec §7.3), counts as missing.
- **Script:** `scripts/field-test-docx.mjs` (`node scripts/field-test-docx.mjs <repo> <folder-with-docx> <out.json>`, after `pnpm build`).

**What this does not measure:** structure and reading order (a word in the wrong place still counts as found), visual fidelity, tables rendered well or badly. Local bodies are under-represented (one municipality, one province); no resolutions or regulations were found as `.docx`.

## Result

16 of 16 valid, 0 errors. Words found: 81032 of 81623 (99.28%).

| #   | Body                                         | Document                                                  | Words in source | Found  | Missing | Why                                                | Text boxes | Images without description |
| --- | -------------------------------------------- | --------------------------------------------------------- | --------------- | ------ | ------- | -------------------------------------------------- | ---------- | -------------------------- |
| 01  | Garante per la protezione dei dati personali | Form: exercise of data-protection rights                  | 633             | 100.0% | 0       | —                                                  | —          | —                          |
| 02  | ANAC                                         | Standard tender notice n. 1/2023 (schema di disciplinare) | 24689           | 98.5%  | 367     | Word table of contents (dropped by rule, reported) | —          | 1                          |
| 03  | Ministry of Education                        | PEI guidelines (Allegato B)                               | 22145           | 100.0% | 1       | 1 word (a note mark glued to a word)               | 29         | 72                         |
| 04  | Ministry of Education                        | PEI template, primary school (Allegato A2)                | 2689            | 100.0% | 0       | —                                                  | 22         | 15                         |
| 05  | Ministry of the Interior (a Prefettura)      | Tender rules, reception services                          | 13515           | 100.0% | 2       | 2 words (not yet explained)                        | —          | —                          |
| 06  | Ministry of the Interior (a Prefettura)      | Application form, foreign company                         | 199             | 100.0% | 0       | —                                                  | —          | —                          |
| 07  | Ministry of Labour                           | Standard statute for an association (APS)                 | 5030            | 100.0% | 0       | —                                                  | —          | —                          |
| 08  | MIMIT                                        | Application template, social economy incentives           | 3581            | 100.0% | 0       | —                                                  | —          | 2                          |
| 09  | Regione Friuli Venezia Giulia                | Project form, international cooperation                   | 445             | 100.0% | 0       | —                                                  | —          | —                          |
| 10  | Regione Friuli Venezia Giulia                | Grant application, local festivals                        | 1146            | 99.3%  | 8       | prompt of one empty form field (reported)          | 3          | —                          |
| 11  | Regione Emilia-Romagna                       | CILA-S unified building form                              | 2280            | 89.4%  | 241     | prompts of 32 empty form fields (reported)         | —          | —                          |
| 12  | Regione Toscana                              | Project form, ESF call                                    | 847             | 100.0% | 0       | —                                                  | —          | 1                          |
| 13  | Regione Lombardia                            | Notice template and application facsimile                 | 2428            | 100.0% | 0       | —                                                  | —          | —                          |
| 14  | Regione Veneto                               | Editable application form                                 | 292             | 100.0% | 0       | —                                                  | 1          | —                          |
| 15  | Provincia di Cuneo                           | Authorisation request, consultancy office                 | 1574            | 100.0% | 0       | —                                                  | 1          | 1                          |
| 16  | Comune di Napoli                             | Self-declaration, disabled parking permit                 | 130             | 100.0% | 0       | —                                                  | —          | 1                          |

## What the test found

The first run, on release 0.2.1, found 79782 of 81623 words (97.74%) and three defects, none visible to the validator:

1. **Text boxes were dropped, and the conversion report did not say so.** Five documents of 16; in the PEI template (04) a quarter of the text, including the filling instructions; in the forms, the revenue-stamp box. Fixed in 0.2.2: the text of a box enters the flow after the paragraph the box is anchored to, and the report says how many.
2. **Table rows and cells wrapped in a content control were skipped**, text included. Fixed in 0.2.2.
3. **The prompt of empty form fields** ("Click or tap here to enter text") was kept in some places and dropped in others, unreported. Since 0.2.2 it is always removed and reported: it is Word's text, not the author's.

After the fixes the missing words are the table of contents of document 02 and the form-field prompts of 10 and 11 — both reported — plus three words not yet explained (03, 05).

## Numbering: found by reading, not by counting

The word count above could not see the fourth defect, because numbers are not words of the source: Word computes them. A reader of document 02 saw it at once.

- **Numbered headings lost their number**: "1.1. LA PIATTAFORMA…" came out as "LA PIATTAFORMA…", while the text keeps referring to "paragraph 13" or "point 2.2".
- **Letters and roman numerals became 1., 2., 3.**: "a) bando di gara; b) disciplinare di gara" came out as "1. … 2. …", and references to "letter a)" no longer resolved.
- **A numbering resumed after other text restarted at 1**: of 107 numbered items in document 02, 49 were numbered "1.".

The cause: a WDF `ol` carries no type and no start, so a browser can only show 1., 2., 3. from one. Since the fix, the number of a numbered heading is part of its text, and a list keeps its `ol` only where that is exactly what Word shows; everywhere else Word's label is written at the start of the item and the list is bulleted ("• a) bando di gara;"). On document 02 the result was checked against the text of its PDF: 61 of 61 headings and 97 of 97 checkable labelled items match (5 items could not be found in the PDF text at all). Ten of the 16 documents have numbered headings or such lists.

One assumption is not verified: when two numbering instances share one definition and the second does not say "restart", the importer continues the count, as Word is understood to do. It decides the numbers in 12 of 2031 documents of the private collection.

## Warnings and other findings

- **One `h1` (spec §6.1.5):** the only validator warning, on 9 documents of 16 — no `h1` in four (01, 03, 07, 14), more than one in five (02: 5, 05: 2, 11: 5, 15: 17, 16: 2). Real Word documents rarely have exactly one top-level heading.
- **Images without a description:** 7 documents of 16 carry pictures with no alternative text in Word and not marked decorative (93 pictures; 72 in document 03). The importer keeps an empty `alt`, invents nothing, and reports the count.
- **Open checks:** three unexplained words (03, 05). (A footnote of document 02 once listed here was not one: Word stores a "continuation notice" among the footnotes, and the first version of the script counted it.)
- **Known limits of the fix:** a text box follows its anchor paragraph, which is not always the visual order on the page; text boxes anchored inside a table cell are not collected yet.

## Sources

Downloaded on 11 November 2026.

- 01 — Garante per la protezione dei dati personali: <https://www.garanteprivacy.it/documents/10160/10704/MODELLO+esercizio+diritti+in+materia+di+protezione+dei+dati+personali.docx/a356cedc-77b9-4f69-b24b-dadf877bb940?version=2.0>
- 02 — ANAC: <https://www.anticorruzione.it/documents/91439/11cd69de-6389-72f8-e0c5-e44c1740a541>
- 03 — Ministry of Education: <https://www.istruzione.it/inclusione-e-nuovo-pei/allegati/ALLEGATO_%20B_%20Linee%20Guida.docx>
- 04 — Ministry of Education: <https://www.istruzione.it/inclusione-e-nuovo-pei/allegati/ALLEGATO_A2_PEI_PRIMARIA.docx>
- 05 — Ministry of the Interior (a Prefettura): <https://prefettura.interno.gov.it/sites/default/files/74/2024-04/all._1_disciplinare_singole_unita_abitative.docx>
- 06 — Ministry of the Interior (a Prefettura): <https://prefettura.interno.gov.it/sites/default/files/26/2024-01/istanza_di_iscrizione_societa-_estera_priva_di_sede_secondaria_con_rappresentanza_stabile_in_italia.docx>
- 07 — Ministry of Labour: <https://www.lavoro.gov.it/documenti/aics-mod-standard-statuto-aps.docx>
- 08 — MIMIT: <https://www.mimit.gov.it/images/stories/documenti/Allegato_1_-_Schema_di_Domanda.docx>
- 09 — Regione Friuli Venezia Giulia: <https://www.regione.fvg.it/rafvg/cms/RAFVG/fondi-europei-fvg-internazionale/cooperazione-internazionale-sviluppo/FOGLIA104/modulistica/18032025_Allegato_A1_Formulario_del_progetto_Quadro.docx>
- 10 — Regione Friuli Venezia Giulia: <https://www.regione.fvg.it/rafvg/cms/RAFVG/GEN/sagre_e_feste_locali/FOGLIA1/allegati/LR_7_2019_art_4_allegato_B_domanda_2026.docx>
- 11 — Regione Emilia-Romagna: <https://territorio.regione.emilia-romagna.it/codice-territorio/modulistica-unificata-regionale/superbonus/modello-cila-s.docx/@@download/file>
- 12 — Regione Toscana: <https://www.regione.toscana.it/documents/10180/135495279/Bando+Fse+progetti+orientamento+post+laurea+Allegato+B1.docx/9401b8ba-5321-ebcc-76b9-6e6af783e81a?t=1715183882584>
- 13 — Regione Lombardia: <https://www.bandi.regione.lombardia.it/servizi/servizio/bandi/download/8a5b205972a7e3ea0172c78320936b18?fileName=Allegato_%20schema%20di%20avviso%20e%20fac%20simile%20di%20domanda.docx>
- 14 — Regione Veneto: <https://bandi.regione.veneto.it/Public/Download?idAllegato=27792>
- 15 — Provincia di Cuneo: <https://www.provincia.cuneo.it/_allegati/trasporti/modulistica/102/agecons-trasporti-supporto-allarea-vasta-02-istanza-autorizzazione-studio-consulenza-societa-rev07.docx>
- 16 — Comune di Napoli: <https://static-www.comune.napoli.it/wp-content/uploads/2024/12/Modulo_editabile_dichiarazione_sostitutiva_contrassegno_disabili.docx>
