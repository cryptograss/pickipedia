<?php

namespace MediaWiki\Extension\PickiPediaInvitations;

use MediaWiki\Auth\AbstractPreAuthenticationProvider;
use MediaWiki\Auth\AuthenticationRequest;
use MediaWiki\Auth\AuthManager;
use MediaWiki\MediaWikiServices;
use StatusValue;

/**
 * Pre-authentication provider that requires invite codes for account creation.
 *
 * Adds an "Invite Code" field to the signup form and validates that:
 * 1. A valid invite code is provided
 * 2. The code hasn't been used
 * 3. The code hasn't expired
 * 4. The requested username matches the invite's intended recipient
 */
class InviteAuthProvider extends AbstractPreAuthenticationProvider {

	/**
	 * Return the applicable authentication requests for account creation.
	 *
	 * @param string $action
	 * @param array $options
	 * @return AuthenticationRequest[]
	 */
	public function getAuthenticationRequests( $action, array $options ) {
		if ( $action === AuthManager::ACTION_CREATE ) {
			$config = MediaWikiServices::getInstance()->getMainConfig();
			if ( $config->get( 'PickiPediaInvitesRequired' ) ) {
				return [ new InviteAuthRequest() ];
			}
		}
		return [];
	}

	/**
	 * Validate account creation request.
	 *
	 * @param \User $user User being created
	 * @param \User $creator User doing the creating
	 * @param AuthenticationRequest[] $reqs
	 * @return StatusValue
	 */
	public function testForAccountCreation( $user, $creator, array $reqs ) {
		$config = MediaWikiServices::getInstance()->getMainConfig();

		// If invites aren't required, allow creation
		if ( !$config->get( 'PickiPediaInvitesRequired' ) ) {
			return StatusValue::newGood();
		}

		// Sysops can create accounts without invites
		// (e.g., creating accounts on behalf of users via Special:CreateAccount)
		$userGroupManager = MediaWikiServices::getInstance()->getUserGroupManager();
		$creatorGroups = $userGroupManager->getUserGroups( $creator );
		if ( in_array( 'sysop', $creatorGroups ) || in_array( 'bureaucrat', $creatorGroups ) ) {
			return StatusValue::newGood();
		}

		// Get the invite code from the request
		$req = AuthenticationRequest::getRequestByClass( $reqs, InviteAuthRequest::class );

		if ( !$req || !$req->inviteCode ) {
			return StatusValue::newFatal( 'pickipediainvitations-code-required' );
		}

		// Validate the code
		$validation = InviteStore::validateCode( $req->inviteCode, $user->getName() );

		if ( !$validation['valid'] ) {
			return StatusValue::newFatal(
				'pickipediainvitations-validation-error',
				$validation['error']
			);
		}

		return StatusValue::newGood();
	}
}

/**
 * Authentication request for invite codes.
 */
class InviteAuthRequest extends AuthenticationRequest {

	/** @var string|null */
	public $inviteCode;

	/**
	 * @return array
	 */
	public function getFieldInfo() {
		// Check for invite code in URL to pre-populate the field
		$request = \RequestContext::getMain()->getRequest();
		$urlInvite = $request->getVal( 'invite', '' );

		return [
			'inviteCode' => [
				'type' => 'string',
				'label' => wfMessage( 'pickipediainvitations-field-invitecode' ),
				'help' => wfMessage( 'pickipediainvitations-field-invitecode-help' ),
				'optional' => false,
				'value' => $urlInvite,
			],
		];
	}

	/**
	 * Load data from web request.
	 *
	 * @param \WebRequest $request
	 */
	public function loadFromSubmission( array $data ) {
		// Check for direct field submission
		if ( isset( $data['inviteCode'] ) ) {
			$this->inviteCode = $data['inviteCode'];
			return true;
		}

		// Also check for pre-filled invite from URL parameter
		$request = \RequestContext::getMain()->getRequest();
		$urlInvite = $request->getVal( 'invite' );
		if ( $urlInvite ) {
			$this->inviteCode = $urlInvite;
			return true;
		}

		return false;
	}

	/**
	 * Describe state of this authentication request.
	 *
	 * @return array
	 */
	public function describeCredentials() {
		return [
			'provider' => wfMessage( 'pickipediainvitations-provider' ),
			'account' => $this->inviteCode ? wfMessage( 'pickipediainvitations-has-code' ) : null,
		];
	}
}
