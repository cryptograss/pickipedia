/**
 * Date to Block Height Converter for Blue Railroad submission forms
 */
(function() {
    'use strict';

    var AVG_BLOCK_TIME = 12.12; // Post-merge average

    function getCurrentBlockFromFooter() {
        var link = document.querySelector('a[href*="etherscan.io/block/"]');
        if (link) {
            var match = link.href.match(/block\/(\d+)/);
            if (match) return parseInt(match[1]);
        }
        return null;
    }

    function dateToBlockHeight(targetDate, refBlock, refTimestamp) {
        var targetTimestamp = targetDate.getTime() / 1000;
        var blocksDiff = Math.round((refTimestamp - targetTimestamp) / AVG_BLOCK_TIME);
        return refBlock - blocksDiff;
    }

    function init() {
        var blockInput = document.querySelector('input[name*="[block_height]"]');
        if (!blockInput) return;

        var container = document.createElement('div');
        container.style.cssText = 'margin-top:8px;';
        container.innerHTML =
            '<label style="display:block;margin-bottom:4px;font-size:0.9em;">Or pick date/time:</label>' +
            '<input type="datetime-local" id="br-datepicker" style="padding:4px;margin-right:8px;">' +
            '<button type="button" id="br-convert" style="padding:4px 12px;">Convert</button>' +
            '<span id="br-status" style="margin-left:8px;font-size:0.9em;color:#666;"></span>';

        blockInput.parentNode.appendChild(container);

        var picker = document.getElementById('br-datepicker');
        var btn = document.getElementById('br-convert');
        var status = document.getElementById('br-status');

        picker.value = new Date().toISOString().slice(0, 16);

        btn.onclick = function() {
            var date = new Date(picker.value);
            if (isNaN(date.getTime())) {
                status.textContent = 'Invalid date';
                status.style.color = 'red';
                return;
            }

            var block = getCurrentBlockFromFooter();
            if (!block) {
                status.textContent = 'No reference block found';
                status.style.color = 'red';
                return;
            }

            var est = dateToBlockHeight(date, block, Date.now() / 1000);
            blockInput.value = est;
            status.textContent = est > block ? 'Future!' : '~estimated';
            status.style.color = est > block ? 'orange' : 'green';
        };
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
