<?php
/**
 * api.php?action=pagecard&titles=A|B: each page in brief (PageCard.php).
 *
 * Asked by a post's own page when a link is pointed at, and by magenta for
 * a post's masthead. It says only what the pages themselves show anyone,
 * so anyone may ask and the answer may be kept.
 *
 * @file
 */

namespace MediaWiki\Extension\PickiPediaContent\Posts;

use MediaWiki\Api\ApiBase;
use Wikimedia\ParamValidator\ParamValidator;

class ApiPageCard extends ApiBase {

	public function execute() {
		$params = $this->extractRequestParams();
		$cards = [];
		foreach ( $params['titles'] as $text ) {
			$cards[] = [ 'asked' => $text ] + PageCard::of( (string)$text );
		}
		$result = $this->getResult();
		$result->addValue( null, $this->getModuleName(), $cards );
		$result->addIndexedTagName( [ $this->getModuleName() ], 'card' );
		$this->getMain()->setCacheMode( 'public' );
		$this->getMain()->setCacheMaxAge( 300 );
	}

	public function getAllowedParams() {
		return [
			'titles' => [
				ParamValidator::PARAM_TYPE => 'string',
				ParamValidator::PARAM_ISMULTI => true,
				ParamValidator::PARAM_REQUIRED => true,
				ParamValidator::PARAM_ISMULTI_LIMIT1 => 20,
				ParamValidator::PARAM_ISMULTI_LIMIT2 => 20,
			],
		];
	}

	protected function getExamplesMessages() {
		return [
			'action=pagecard&titles=Main_Page' => 'apihelp-pagecard-example-1',
		];
	}
}
