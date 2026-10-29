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

// A function ends at the first line holding only its own indentation and a
// closing brace -- not by counting braces, which its regexes and quoted '{'
// would throw off (findTemplateContaining has both).
function lift(name) {
	const start = src.indexOf(`function ${name}(`);
	if (start < 0) throw new Error(`no ${name}`);
	const indent = src.slice(src.lastIndexOf('\n', start) + 1, start);
	const end = src.indexOf(`\n${indent}}`, start);
	if (end < 0) throw new Error(`no end to ${name}`);
	return src.slice(start, end + indent.length + 2);
}

const scope = {};
eval(lift('stripWikitext') + lift('findProposedTagBySource') + lift('findProposedTagContaining') +
	lift('findTemplateContaining') + lift('verifiedMark') +
	'\nscope.mark = verifiedMark; scope.bySource = findProposedTagBySource; scope.byText = findProposedTagContaining;' +
	' scope.byTemplate = findTemplateContaining;');

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

console.log('\n{{Bot_proposes}} found by its rendered text, links and code included:');
// 2026-10-15: Skyler couldn't verify these on Cryptograss:Magenta 26 Million.
// The rendered text has a link's words, or code's, where the source has markup.
const proposals = [
	"{{Bot_proposes|Open [https://memory-lane.maybelle.cryptograss.live/moods/ memory-lane /moods/] and pick a Mood from the list on the side.|by=Magent}}",
	"{{Bot_proposes|Run <code>./magenta.sh login</code> there. It signs a challenge with your key.|by=Magent}}",
	"{{Bot_proposes|Every message is tagged by author, so agents can tell who is speaking.|by=Magent}}",
].join('\n\n');
const linked = scope.byTemplate(proposals, 'Open memory-lane /moods/ and pick a Mood from the list on the side.');
check('a link in its first words', linked && linked.content.startsWith('Open [https://'));
const coded = scope.byTemplate(proposals, 'Run ./magenta.sh login there. It signs a challenge with your key.');
check('code in its first words', coded && coded.content.startsWith('Run <code>'));
check('plain prose, as before',
	scope.byTemplate(proposals, 'Every message is tagged by author, so agents can tell who is speaking.') !== null);
check('and nothing that is not there',
	scope.byTemplate(proposals, 'Open the gates and let the bus through.') === null);

// Left blank, or left as the template's "unspecified": who vouched (Justin, 26 Oct).
check('blank: by whoever verified', scope.mark('', 'JMyles') === '{{verified|by JMyles}}', scope.mark('', 'JMyles'));
check('"unspecified" is no basis', scope.mark('unspecified', 'JMyles') === '{{verified|by JMyles}}', scope.mark('unspecified', 'JMyles'));
check('words: the basis', scope.mark('I was there', 'JMyles') === '{{verified|I was there}}');
check('a link: a source', scope.mark('https://setlist.fm/x', 'JMyles') === '{{source|https://setlist.fm/x}}');

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
