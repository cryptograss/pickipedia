// Checks for how the Verify button finds the claim it was clicked on.
//
// The functions are lifted out of the shipped file and evaluated on their own,
// because the file is an IIFE that expects mw and jQuery. Ugly, and better
// than testing a copy that can drift from what runs.
//
// Usage:
//   node extensions/PickiPediaVerification/tests/check-verify-js.mjs
import { readFileSync } from 'node:fs';

const src = readFileSync(
	new URL('../resources/ext.pickipediaVerification.verify.js', import.meta.url),
	'utf8');

function lift(name) {
	const start = src.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`no ${name}`);
	let depth = 0, i = src.indexOf('{', start);
	const open = i;
	for (; i < src.length; i++) {
		if (src[i] === '{') depth++;
		else if (src[i] === '}' && --depth === 0) break;
	}
	return src.slice(start, i + 1);
}

const scope = {};
eval(lift('stripWikitext') + lift('findProposedTagBySource') + lift('findProposedTagContaining') +
	'\nscope.bySource = findProposedTagBySource; scope.byText = findProposedTagContaining;');

let failures = 0;
const check = (name, ok, detail = '') => {
	if (ok) console.log(`  ok   ${name}`);
	else { failures++; console.log(`  FAIL ${name}${detail ? '\n       ' + detail : ''}`); }
};

const page = [
	'{{MusicianInfo',
	'|name=Tony Rice',
	'}}',
	'',
	'<proposed by="Magent">',
	'{{On the podcasts}}',
	'</proposed>',
	'',
	'<proposed by="Magent">He plays a 1923 Loar.</proposed>',
].join('\n');

console.log('\nFinding the claim by its own wikitext:');

const template = scope.bySource(page, '{{On the podcasts}}');
check('a template call is found', template !== null);
check('and the whole marker is replaced, tags included',
	template && page.slice(template.start, template.end) ===
		'<proposed by="Magent">\n{{On the podcasts}}\n</proposed>');
check('unwrapping leaves the call alone', template && template.content === '{{On the podcasts}}');

check('prose is found too', scope.bySource(page, 'He plays a 1923 Loar.') !== null);
check('an unrelated claim is not matched', scope.bySource(page, '{{Firehose}}') === null);
check('no attribute means no match, so the fallback runs',
	scope.bySource(page, '') === null);

const twice = [
	'<proposed by="Magent">{{Firehose|show=A}}</proposed>',
	'<proposed by="Magent">{{Firehose|show=B}}</proposed>',
].join('\n\n');
const second = scope.bySource(twice, '{{Firehose|show=B}}');
check('the right one of two similar claims',
	second && twice.slice(second.start, second.end).includes('show=B'));

console.log('\nThe old rendered-text search, kept as a fallback:');
check('still finds prose', scope.byText(page, 'He plays a 1923 Loar.') !== null);
check('still cannot find a template, which is the bug',
	scope.byText(page, 'On the podcasts Bluegrass Jam Along Tony Rice audio') === null);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
