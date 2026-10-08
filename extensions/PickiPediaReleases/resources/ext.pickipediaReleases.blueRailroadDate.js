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
 * Blue Railroad Submission: pick a date, get an Ethereum block height.
 *
 * Does nothing unless the Blue Railroad Submission form is on the page.
 */
(function() {
    'use strict';
    
    // Only run on the Blue Railroad Submission form
    if (!document.querySelector('input[name="Blue Railroad Submission[block_height]"]')) {
        return;
    }
    
    // Reference point: known block and timestamp
    // Post-merge average block time is ~12.12 seconds
    const AVG_BLOCK_TIME = 12.12;
    
    // Get current block from footer (format: "24,328,442")
    function getCurrentBlockFromFooter() {
        const footerLink = document.querySelector('a[href*="etherscan.io/block/"]');
        if (footerLink) {
            const match = footerLink.href.match(/block\/(\d+)/);
            if (match) return parseInt(match[1]);
        }
        return null;
    }
    
    // Calculate block height from date
    function dateToBlockHeight(targetDate, refBlock, refTimestamp) {
        const targetTimestamp = targetDate.getTime() / 1000;
        const secondsDiff = refTimestamp - targetTimestamp;
        const blocksDiff = Math.round(secondsDiff / AVG_BLOCK_TIME);
        return refBlock - blocksDiff;
    }
    
    // Add the datepicker UI
    function addDatePicker() {
        const blockInput = document.querySelector('input[name="Blue Railroad Submission[block_height]"]');
        if (!blockInput) return;

        // Added in the move: until the copy in MediaWiki:Common.js is
        // removed, both run, and without this the form grows a second
        // picker with duplicate element ids. Guarding on the DOM rather
        // than a flag works whichever copy gets there first.
        if (document.getElementById('br-datepicker')) return;
        
        const container = document.createElement('div');
        container.style.marginTop = '8px';
        container.innerHTML = `
            <label style="display: block; margin-bottom: 4px; font-size: 0.9em;">
                Or pick a date/time:
            </label>
            <input type="datetime-local" id="br-datepicker" style="padding: 4px; margin-right: 8px;">
            <button type="button" id="br-convert-btn" style="padding: 4px 12px; cursor: pointer;">
                Convert to Block
            </button>
            <span id="br-status" style="margin-left: 8px; font-size: 0.9em; color: #666;"></span>
        `;
        
        blockInput.parentNode.appendChild(container);
        
        const datePicker = document.getElementById('br-datepicker');
        const convertBtn = document.getElementById('br-convert-btn');
        const status = document.getElementById('br-status');
        
        // Set default to now
        const now = new Date();
        datePicker.value = now.toISOString().slice(0, 16);
        
        convertBtn.addEventListener('click', function() {
            const selectedDate = new Date(datePicker.value);
            if (isNaN(selectedDate.getTime())) {
                status.textContent = 'Invalid date';
                status.style.color = 'red';
                return;
            }
            
            const currentBlock = getCurrentBlockFromFooter();
            if (!currentBlock) {
                status.textContent = 'Could not find reference block';
                status.style.color = 'red';
                return;
            }
            
            const currentTimestamp = Date.now() / 1000;
            const estimatedBlock = dateToBlockHeight(selectedDate, currentBlock, currentTimestamp);
            
            if (estimatedBlock > currentBlock) {
                status.textContent = 'Date is in the future!';
                status.style.color = 'orange';
            } else {
                status.textContent = '~estimated';
                status.style.color = 'green';
            }
            
            blockInput.value = estimatedBlock;
        });
    }
    
    // Run when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addDatePicker);
    } else {
        addDatePicker();
    }
})();
