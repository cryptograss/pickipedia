/**
 * The inline Verify button.
 *
 * Adds a Verify button to every proposed claim on the page — <proposed>
 * blocks, {{Bot_proposes}} and {{claim}} spans, and {{Show}} infoboxes — and
 * rewrites the page when a logged-in reader attests to one.
 *
 * Moved here from MediaWiki:Gadget-verify.js. It was the last piece of this
 * workflow living on the wiki rather than in the repository, which meant it
 * had no tests, no review, and no way to change it except pasting into an
 * interface page. It ships with the extension that renders the markers it
 * reads, so the two halves move together.
 *
 * Loaded only on pages that actually hold a marker; see ParserHooks.
 */
(function() {
    'use strict';

    // Only run for logged-in users
    if (mw.config.get('wgUserName') === null) {
        return;
    }

    // Wait for page to be ready
    mw.hook('wikipage.content').add(function($content) {
        // Find all claim and bot_proposes elements (inline)
        // .pv-proposed is the <proposed> tag from the PickiPediaVerification
        // extension. Both its forms are handled here: the inline one is a
        // <span>, the block one a <div> wrapping a whole template call.
        var $claims = $content.find('.claim-unverified, span.bot-proposal, .pv-proposed');
        
        $claims.each(function() {
            var $claim = $(this);
            
            // Don't add button twice
            if ($claim.find('.verify-btn').length > 0) {
                return;
            }

            var $btn = $('<button>')
                .addClass('verify-btn')
                .text('✓ Verify')
                .css({
                    'margin-left': '0.5em',
                    'font-size': '0.8em',
                    'padding': '1px 6px',
                    'cursor': 'pointer',
                    'background': '#f8f9fa',
                    'border': '1px solid #a2a9b1',
                    'border-radius': '3px',
                    'vertical-align': 'middle'
                })
                .on('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openVerifyDialog($claim, false);
                });

            $claim.append(' ').append($btn);
        });

        // Find Show infoboxes that need verification
        var $shows = $content.find('.show-infobox.bot-proposal');
        
        $shows.each(function() {
            var $show = $(this);
            
            // Don't add button twice
            if ($show.find('.verify-show-btn').length > 0) {
                return;
            }

            var $btn = $('<button>')
                .addClass('verify-show-btn')
                .text('✓ Verify This Show')
                .css({
                    'display': 'block',
                    'width': '100%',
                    'margin-top': '0.5em',
                    'padding': '6px 12px',
                    'cursor': 'pointer',
                    'background': '#f8f9fa',
                    'border': '1px solid #a2a9b1',
                    'border-radius': '3px',
                    'font-size': '0.9em'
                })
                .on('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openVerifyDialog($show, true);
                });

            $show.append($btn);
        });
    });

    function openVerifyDialog($element, isShow) {
        var claimText;
        if (isShow) {
            // For shows, build a summary from the infobox content
            var artists = $element.find('div:contains("Artists:")').text().replace('Artists:', '').trim();
            var venue = $element.find('div:contains("Venue:")').text().replace('Venue:', '').trim();
            var block = $element.find('div:contains("Block:")').text().replace('Block:', '').trim();
            claimText = artists + ' @ ' + venue + ' (block ' + block + ')';
        } else {
            // The badge and byline are the marker's own chrome, not part of
            // the claim. Leaving them in makes claimText read
            // "...[unverified]Proposed by Magent", which then fails to match
            // anything in the wikitext.
            claimText = $element.clone()
                .children('.verify-btn, .pv-proposed__badge, .pv-proposed__byline')
                .remove().end().text().trim();
        }
        
        // The wikitext this marker wraps, straight from <proposed>. This is
        // what identifies the claim; the rendered text above is only for
        // showing the user what they are about to verify.
        var claimSource = $element.attr('data-pv-claim') || '';

        // {{Bot_proposes}} says "unspecified" where the bot named no source: not a source, and never to be
        // written back as one ({{verified|unspecified}} said nothing of who vouched -- Justin, 26 Oct).
        var existingSource = $element.data('source') || '';
        if (/^unspecified$/i.test(String(existingSource).trim())) existingSource = '';
        var isBotProposal = $element.hasClass('bot-proposal') ||
            $element.hasClass('pv-proposed');
        // What the proposer said about the claim: "supporting text" for words
        // that only explain the page, or a pointer into the source.
        var existingNote = String($element.attr('data-note') || '').trim();
        var isRemoval = $element.attr('data-pv-action') === 'remove';
        // The claim can be corrected before it is verified, but only where we
        // know its wikitext: a <proposed> block. Older markers are found by
        // their rendered text, and a correction there could land anywhere.
        var editable = !isShow && !isRemoval && claimSource !== '';
        
        // Create dialog content
        var $dialog = $('<div>').addClass('verify-dialog');
        
        var $form = $('<form>').on('submit', function(e) {
            e.preventDefault();
            if (isShow) {
                submitShowVerification($element, $form, claimText, $overlay, $dialog);
            } else {
                submitVerification($element, $form, claimText, $overlay, $dialog,
                    claimSource);
            }
        });

        if (editable) {
            $form.append(
                $('<label>').attr('for', 'verify-claim').html('<strong>Verifying</strong> (correct it here if it\'s wrong):'),
                $('<br>'),
                $('<textarea>')
                    .attr({ id: 'verify-claim', name: 'claim', rows: Math.min(12, claimSource.split('\n').length + 1) })
                    .val(claimSource)
                    .css({ width: '100%', marginBottom: '1em', padding: '6px', boxSizing: 'border-box',
                        fontFamily: 'monospace', fontSize: '0.9em' })
            );
        } else {
            $form.append(
                $('<p>').css('margin-top', '0').html('<strong>Verifying:</strong> ' + mw.html.escape(claimText))
            );
        }

        var link = sourceLink(existingSource);
        if (link) {
            // The source first and plainest: where it is, and a way to open
            // the whole of it beside the page.
            $form.append(
                $('<div>').addClass('verify-source-preview').css({
                    border: '1px solid #c8ccd1', borderRadius: '3px', padding: '8px',
                    marginBottom: '1em', background: '#f8f9fa'
                }).append(
                    $('<div>').css({ fontSize: '0.85em', color: '#54595d' }).text('Source'),
                    $('<div>').css({ fontWeight: 'bold' }).text(link.host),
                    $('<div>').css({ fontSize: '0.85em', wordBreak: 'break-all' }).text(link.rest),
                    $('<a>').attr({ href: link.href, target: '_blank', rel: 'noopener noreferrer' })
                        .text('Open the full source ↗')
                )
            );
        }

        $form.append(
            $('<label>').attr('for', 'verify-source').text('Source (optional):'),
            $('<br>'),
            $('<input>')
                .attr({
                    type: 'text',
                    id: 'verify-source',
                    name: 'source',
                    placeholder: 'https://... or "I was there" or leave blank'
                })
                .val(existingSource || '')
                .css({ width: '100%', marginBottom: '1em', padding: '6px', boxSizing: 'border-box' })
        );

        if (isBotProposal && existingSource) {
            $form.find('label[for="verify-source"]').after(
                $('<div>').css({ fontSize: '0.9em', color: '#666', marginBottom: '0.5em' })
                    .text('Bot suggested source: ' + existingSource)
            );
        }

        $form.append(
            $('<label>').attr('for', 'verify-note').text('Note (optional):'),
            $('<br>'),
            $('<textarea>')
                .attr({
                    id: 'verify-note',
                    name: 'note',
                    rows: 3,
                    placeholder: 'Additional context about your verification...'
                })
                .val(existingNote)
                .css({ width: '100%', marginBottom: '1em', padding: '6px', boxSizing: 'border-box' })
        );

        $form.append(
            $('<button>')
                .attr('type', 'submit')
                .text('Confirm Verification')
                .css({
                    padding: '8px 16px',
                    background: '#36c',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    marginRight: '8px'
                }),
            $('<button>')
                .attr('type', 'button')
                .text('Cancel')
                .css({
                    padding: '8px 16px',
                    background: '#f8f9fa',
                    border: '1px solid #a2a9b1',
                    borderRadius: '3px',
                    cursor: 'pointer'
                })
                .on('click', function() {
                    $overlay.remove();
                    $dialog.remove();
                })
        );

        $dialog.append($form);
        
        // Style the dialog
        $dialog.css({
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            zIndex: 10000,
            minWidth: '400px',
            maxWidth: '90vw'
        });

        // Add overlay
        var $overlay = $('<div>').css({
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 9999
        }).on('click', function() {
            $overlay.remove();
            $dialog.remove();
        });

        $('body').append($overlay).append($dialog);
        $dialog.find('#verify-source').focus();
    }

    function submitShowVerification($show, $form, claimText, $overlay, $dialog) {
        var source = $form.find('#verify-source').val().trim();
        var note = $form.find('#verify-note').val().trim();
        var pageName = mw.config.get('wgPageName');
        var userName = mw.config.get('wgUserName');
        var timestamp = new Date().toISOString().split('T')[0];

        // Disable form while processing
        $form.find('button').prop('disabled', true);
        $form.find('button[type="submit"]').text('Verifying...');

        var api = new mw.Api();
        
        api.get({
            action: 'query',
            titles: pageName,
            prop: 'revisions',
            rvprop: 'content',
            rvslots: 'main',
            formatversion: 2
        }).then(function(data) {
            var page = data.query.pages[0];
            var content = page.revisions[0].slots.main.content;

            // For Show template, change status=proposed to status=verified
            var newContent = content
                .replace(/\|status=proposed/g, '|status=verified')
                .replace(/\|by=[^\n|}]*/g, '|by=' + userName)
                .replace(/\|source=[^\n|}]*/g, '|source=' + (source && !/^unspecified$/i.test(source) ? source : 'verified by ' + userName));

            if (newContent === content) {
                mw.notify('Could not update show status. It may have already been verified.', { type: 'error' });
                $form.find('button').prop('disabled', false);
                $form.find('button[type="submit"]').text('Confirm Verification');
                return;
            }

            var editSummary = 'Verified show: ' + claimText.substring(0, 50);
            
            return api.postWithToken('csrf', {
                action: 'edit',
                title: pageName,
                text: newContent,
                summary: editSummary
            }).then(function() {
                // Add to talk page
                return addTalkPageEntry(api, pageName, claimText, source, note, userName, timestamp);
            }).then(function() {
                mw.notify('Show verified!', { type: 'success' });
                $overlay.remove();
                $dialog.remove();
                // Reload to show changes
                location.reload();
            });
        }).catch(function(err) {
            mw.notify('Error: ' + err, { type: 'error' });
            $form.find('button').prop('disabled', false);
            $form.find('button[type="submit"]').text('Confirm Verification');
        });
    }

    /**
     * Strip wikitext formatting for comparison purposes.
     * Removes bold ('''), italic (''), and common markup.
     */
    function stripWikitext(text) {
        return text
            // External links and HTML render as their text alone: without
            // these, a claim with a link or <code> in its first 40 characters
            // could never be found ("Could not find the claim in page source").
            .replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')  // [https://x text] -> text
            .replace(/<\/?[a-z][^>]*>/gi, '')  // <code>, <b>...: their contents stay
            .replace(/'{2,}/g, '')  // Remove '' and '''
            .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')  // [[link|text]] -> text
            .replace(/\{\{!\}\}/g, '|')  // {{!}} -> |
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    /**
     * Find a Bot_proposes or claim template in wikitext that contains the given text.
     * Returns {start, end, content} or null if not found.
     * Properly handles nested templates like {{!}}.
     */
    function findTemplateContaining(wikitext, searchText) {
        // Normalize searchText for comparison - collapse whitespace
        var normalizedSearch = stripWikitext(searchText).substring(0, 40);
        
        // Find all {{Bot_proposes or {{claim occurrences
        var templateRegex = /\{\{(Bot_proposes|claim)\s*\|/gi;
        var match;
        
        while ((match = templateRegex.exec(wikitext)) !== null) {
            var startIndex = match.index;
            var depth = 0;
            var i = startIndex;
            
            // Find the matching closing }}
            while (i < wikitext.length - 1) {
                if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
                    depth++;
                    i += 2;
                } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
                    depth--;
                    if (depth === 0) {
                        var endIndex = i + 2;
                        var templateContent = wikitext.substring(startIndex, endIndex);
                        
                        // Extract the actual content (first parameter, before |by= or |source=)
                        var inner = templateContent.replace(/^\{\{(Bot_proposes|claim)\s*\|\s*/i, '').replace(/\}\}$/, '');
                        // Remove |by=... and |source=... parameters
                        inner = inner.replace(/\|by=[^|}]*/gi, '').replace(/\|source=[^|}]*/gi, '');
                        
                        // Strip wikitext formatting for comparison
                        var normalizedInner = stripWikitext(inner);
                        
                        // Check if this template contains our search text
                        if (normalizedInner.indexOf(normalizedSearch) !== -1) {
                            return {
                                start: startIndex,
                                end: endIndex,
                                fullMatch: templateContent,
                                content: inner.trim()
                            };
                        }
                        break;
                    }
                    i += 2;
                } else {
                    i++;
                }
            }
        }
        return null;
    }

    /**
     * Find a <proposed>...</proposed> block whose contents match the claim.
     *
     * Simpler than findTemplateContaining() below, and that is the point of
     * the tag: there are no balanced braces to walk and no escaped pipes to
     * undo, because tag content is never parsed as template parameters.
     *
     * Returns {start, end, fullMatch, content, wasTag} or null.
     */
    function findProposedTagBySource(wikitext, claimSource) {
        var wanted = claimSource.trim();
        if (!wanted) {
            return null;
        }

        var tagRegex = /<proposed(?:\s[^>]*)?>([\s\S]*?)<\/proposed\s*>/gi;
        var match;

        while ((match = tagRegex.exec(wikitext)) !== null) {
            var inner = match[1].replace(/^\n/, '').replace(/\n$/, '');
            if (inner.trim() === wanted) {
                return {
                    start: match.index,
                    end: match.index + match[0].length,
                    fullMatch: match[0],
                    content: inner,
                    wasTag: true
                };
            }
        }
        return null;
    }

    /**
     * Find a <proposed> block by the text it renders to.
     *
     * The fallback, for pages rendered before the extension began emitting
     * data-pv-claim. It compares rendered output against page source, which
     * holds only for prose: a template call renders to text that appears
     * nowhere in the source, and every such claim failed to verify
     * (pickipedia#122).
     */
    function findProposedTagContaining(wikitext, searchText) {
        var normalizedSearch = stripWikitext(searchText).substring(0, 40);
        var tagRegex = /<proposed(?:\s[^>]*)?>([\s\S]*?)<\/proposed\s*>/gi;
        var match;

        while ((match = tagRegex.exec(wikitext)) !== null) {
            // Block form puts the tags on their own lines; drop one newline
            // each side so verifying doesn't leave a blank line behind.
            var inner = match[1].replace(/^\n/, '').replace(/\n$/, '');

            if (stripWikitext(inner).indexOf(normalizedSearch) !== -1) {
                return {
                    start: match.index,
                    end: match.index + match[0].length,
                    fullMatch: match[0],
                    content: inner,
                    wasTag: true
                };
            }
        }
        return null;
    }

    // What a verified claim ends with: {{source|url}} for a link, {{verified|basis}} for words, and with
    // neither, who vouched: {{verified|by Name}} -- "I am in a position to know this" (Justin, 26 Oct).
    // "unspecified" is the template's placeholder, never a basis.
    function verifiedMark(source, userName) {
        source = String(source || '').trim();
        if (/^unspecified$/i.test(source)) source = '';
        if (source.match(/^https?:\/\//)) {
            return '{{source|' + source + '}}';
        }
        return '{{verified|' + (source || 'by ' + userName) + '}}';
    }

    // The wikitext that stays once a claim is verified: the person's
    // correction where they made one, else what was proposed. An emptied box
    // is not a correction to nothing; deleting is a removal, proposed as one.
    function verifiedContent(proposed, corrected) {
        if (corrected === null || corrected === undefined) return proposed;
        corrected = String(corrected).trim();
        // Unchanged stays byte for byte what was proposed, whitespace included.
        if (corrected === '' || corrected === String(proposed).trim()) return proposed;
        return corrected;
    }

    // A source the dialog can show as a place: its host, the rest of it, and
    // a link. Null for words ("I was there"), which need no preview.
    function sourceLink(source) {
        var m = String(source || '').trim().match(/^(https?):\/\/([^\/?#\s]+)([^\s]*)$/i);
        if (!m) return null;
        return {
            href: m[0],
            host: m[2].replace(/^www\./i, ''),
            rest: m[3] && m[3] !== '/' ? m[3] : ''
        };
    }

    function submitVerification($claim, $form, claimText, $overlay, $dialog,
        claimSource) {
        var source = $form.find('#verify-source').val().trim();
        var $edited = $form.find('#verify-claim');
        var corrected = $edited.length ? $edited.val().trim() : null;
        var note = $form.find('#verify-note').val().trim();
        var pageName = mw.config.get('wgPageName');
        var userName = mw.config.get('wgUserName');
        var timestamp = new Date().toISOString().split('T')[0];

        // Disable form while processing
        $form.find('button').prop('disabled', true);
        $form.find('button[type="submit"]').text('Verifying...');

        var api = new mw.Api();
        
        api.get({
            action: 'query',
            titles: pageName,
            prop: 'revisions',
            rvprop: 'content',
            rvslots: 'main',
            formatversion: 2
        }).then(function(data) {
            var page = data.query.pages[0];
            var content = page.revisions[0].slots.main.content;

            // The claim's own wikitext if the page has it, then the older
            // guesses: rendered-text search, then the template wrappers.
            var found = findProposedTagBySource(content, claimSource || '') ||
                findProposedTagContaining(content, claimText) ||
                findTemplateContaining(content, claimText);
            
            if (!found) {
                mw.notify('Could not find the claim in page source. It may have been modified.', { type: 'error' });
                $form.find('button').prop('disabled', false);
                $form.find('button[type="submit"]').text('Confirm Verification');
                return;
            }

            // Build replacement - use {{source|...}} for URLs, {{verified|...}} for text
            var replacement;
            // {{Bot_proposes}} is a template call, so any pipe in the content
            // had to be escaped to {{!}} going in. Unescaping is part of
            // removing the wrapper, not an extra step -- skipping it is what
            // left {{!}} baked into ~25 pages. A <proposed> tag never escaped
            // anything, so there is nothing to undo.
            var cleanContent = found.wasTag ?
                found.content :
                found.content.replace(/\{\{!\}\}/g, '|');

            // A proposed removal is verified by taking the text away, the
            // line it stood on included.
            var removal = found.wasTag &&
                /^<proposed\b[^>]*\baction\s*=\s*["']?remove\b/i.test(found.fullMatch);
            var end = found.end;
            if (removal && content.charAt(end) === '\n') {
                end++;
            }

            replacement = removal ? '' :
                verifiedContent(cleanContent, corrected) + verifiedMark(source, userName);
            var wasCorrected = !removal && corrected !== null && corrected !== '' &&
                corrected !== cleanContent.trim();
            
            var newContent = content.substring(0, found.start) + replacement + content.substring(end);

            var label = (claimSource || claimText).replace(/\s+/g, ' ').trim();
            var editSummary = 'Verified: "' + label.substring(0, 50) +
                (label.length > 50 ? '...' : '') + '"';
            
            return api.postWithToken('csrf', {
                action: 'edit',
                title: pageName,
                text: newContent,
                summary: editSummary
            }).then(function() {
                // Add to talk page
                return addTalkPageEntry(api, pageName, claimText, source, note, userName, timestamp,
                    wasCorrected ? { from: cleanContent.trim(), to: corrected } : null);
            }).then(function() {
                mw.notify('Verification recorded!', { type: 'success' });
                $overlay.remove();
                $dialog.remove();
                // Reload to show changes
                location.reload();
            });
        }).catch(function(err) {
            mw.notify('Error: ' + err, { type: 'error' });
            $form.find('button').prop('disabled', false);
            $form.find('button[type="submit"]').text('Confirm Verification');
        });
    }

    function addTalkPageEntry(api, pageName, claimText, source, note, userName, timestamp,
        correction) {
        // The talk page of the page's own namespace. 'Talk:' + pageName was
        // only right in main: on Cryptograss:, Song:, Release: and the rest it
        // made "Talk:Cryptograss:...", which the API refuses as invalidtitle
        // after the claim itself has already been saved (Justin, 10 Nov).
        var talkTitle = mw.Title.newFromText(pageName);
        talkTitle = talkTitle && talkTitle.getTalkPage();
        if (!talkTitle) {
            // A namespace with no talk namespace: the claim is verified; there
            // is nowhere to write the note, and that isn't an error.
            return $.Deferred().resolve().promise();
        }
        var talkPage = talkTitle.getPrefixedText();

        var entry = '\n== Verification by ' + userName + ' (' + timestamp + ') ==\n';
        entry += "'''Claim:''' " + claimText + '\n\n';
        if (source) {
            entry += "'''Source:''' " + source + '\n';
        }
        if (note) {
            entry += "\n'''Note:''' " + note + '\n';
        }
        if (correction) {
            // What the bot wrote and what the person made it, so the
            // correction is on the record and not only in the history.
            entry += "\n'''Corrected from:''' <code><nowiki>" + correction.from +
                "</nowiki></code>\n\n'''to:''' <code><nowiki>" + correction.to + '</nowiki></code>\n';
        }

        return api.postWithToken('csrf', {
            action: 'edit',
            title: talkPage,
            appendtext: entry,
            summary: 'Recorded verification of claim'
        });
    }
})();