/**
 * Moved out of MediaWiki:Common.js, unchanged except where noted below.
 *
 * That page is edited by pasting into a text box: no review, no syntax
 * check, no deploy, and no history beyond wiki revisions. On 15 September
 * 2026 a bad paste there took the whole wiki's JavaScript down for 23
 * minutes. Code that ships with the extension is reviewed, checked by CI
 * (pickipedia#126) and deployed by Jenkins instead.
 *
 * Each of these scripts loads on every page, as it did from Common.js, and
 * returns immediately unless the page it cares about is the one being
 * shown.
 *
 * See cryptograss/pickipedia#124 for the video player, which went first.
 */

/**
 * Instrument form: require either a nickname or a complete maker identity
 * (make, model and serial), and derive the page name from whichever was
 * given.
 *
 * Does nothing unless the Instrument form is on the page.
 */
(function() {
    'use strict';

    mw.hook('pf.formValidation').add(function(args) {
        var nickname = document.querySelector('input[name="Instrument[nickname]"]');
        if (!nickname) return;

        var make = document.querySelector('input[name="Instrument[make]"]');
        var model = document.querySelector('input[name="Instrument[model]"]');
        var serial = document.querySelector('input[name="Instrument[serial]"]');

        var nickVal = nickname.value.trim();
        var makeVal = make ? make.value.trim() : '';
        var modelVal = model ? model.value.trim() : '';
        var serialVal = serial ? serial.value.trim() : '';

        var hasNickname = nickVal !== '';
        var hasMakerComplete = makeVal !== '' && modelVal !== '' && serialVal !== '';

        if (!hasNickname && !hasMakerComplete) {
            args.numErrors += 1;
            if (makeVal !== '' || modelVal !== '' || serialVal !== '') {
                alert('Maker identification requires all three: make, model, and serial number. Or provide a nickname instead.');
            } else {
                alert('Please provide either a nickname or maker identification (make, model, and serial number).');
            }
            return;
        }

        // If no nickname, fill it from make/model/serial for page naming
        if (!hasNickname) {
            nickname.value = makeVal + ' ' + modelVal + ' ' + serialVal;
        }
    });
})();
