<?php
/**
 * PickiPedia Diagnostic Script
 * Tests PHP environment and MediaWiki initialization
 */

echo "<pre>";
echo "=== PHP Environment ===\n";
echo "PHP Version: " . phpversion() . "\n";
echo "Memory Limit: " . ini_get('memory_limit') . "\n";
echo "REMOTE_ADDR: " . ($_SERVER['REMOTE_ADDR'] ?? 'NOT SET') . "\n";
echo "HTTP_X_FORWARDED_FOR: " . ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? 'NOT SET') . "\n";
echo "REQUEST_URI: " . ($_SERVER['REQUEST_URI'] ?? 'NOT SET') . "\n";
echo "SCRIPT_FILENAME: " . ($_SERVER['SCRIPT_FILENAME'] ?? 'NOT SET') . "\n";

echo "\n=== Testing MediaWiki Load ===\n";

// Try to load MediaWiki piece by piece to find where it breaks
$steps = [
    'Define MW constant' => function() {
        define('MEDIAWIKI', true);
        return true;
    },
    'Load Defines.php' => function() {
        require_once __DIR__ . '/includes/Defines.php';
        return true;
    },
    'Load AutoLoader' => function() {
        require_once __DIR__ . '/includes/AutoLoader.php';
        return true;
    },
    'Load DefaultSettings' => function() {
        require_once __DIR__ . '/includes/DefaultSettings.php';
        return true;
    },
    'Load LocalSettings' => function() {
        require_once __DIR__ . '/LocalSettings.php';
        return true;
    },
];

foreach ($steps as $name => $fn) {
    echo "  $name... ";
    try {
        $fn();
        echo "OK\n";
    } catch (Throwable $e) {
        echo "FAILED: " . $e->getMessage() . "\n";
        echo "  File: " . $e->getFile() . ":" . $e->getLine() . "\n";
        break;
    }
}

echo "\n=== All SERVER Variables ===\n";
print_r($_SERVER);
echo "</pre>";
