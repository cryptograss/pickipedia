<?php
namespace MediaWiki\Extension\BlueRailroadIntegration;

use MediaWiki\Output\OutputPage;
use Skin;

class Hooks {
    /**
     * Load datepicker module on Blue Railroad form pages
     */
    public static function onBeforePageDisplay(OutputPage $out, Skin $skin): void {
        $title = $out->getTitle();

        // Load on FormEdit pages for Blue Railroad
        if ($title && $title->isSpecial('FormEdit')) {
            $out->addModules(['ext.bluerailroad.datepicker']);
        }
    }
}
