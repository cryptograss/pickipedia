# PickiPedia Preview Container
# Builds MediaWiki with extensions for local testing
#
# Build args:
#   MEDIAWIKI_VERSION - MediaWiki version to install (default: 1.43.0)

FROM php:8.2-apache

ARG MEDIAWIKI_VERSION=1.43.0

# Install dependencies
RUN apt-get update && apt-get install -y \
    libicu-dev \
    libzip-dev \
    libpng-dev \
    libjpeg-dev \
    libfreetype6-dev \
    imagemagick \
    git \
    unzip \
    curl \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install \
        intl \
        mysqli \
        opcache \
        gd \
        zip \
        calendar \
    && rm -rf /var/lib/apt/lists/*

# Install composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Download and extract MediaWiki
RUN MW_MAJOR=$(echo ${MEDIAWIKI_VERSION} | cut -d. -f1,2) \
    && curl -fSL "https://releases.wikimedia.org/mediawiki/${MW_MAJOR}/mediawiki-${MEDIAWIKI_VERSION}.tar.gz" -o mediawiki.tar.gz \
    && tar -xzf mediawiki.tar.gz --strip-components=1 -C /var/www/html \
    && rm mediawiki.tar.gz

# Copy our composer.json for extensions
COPY composer.json /var/www/html/composer.local.json

# Install extensions via composer
#
# The two adjustments before the update mirror the Jenkinsfile, and without
# them this image cannot be built at all:
#
#   - Composer's audit gate refuses to load packages with known advisories,
#     and it reads that config only from the ROOT composer.json. Ours lives in
#     composer.local.json, so it gets stamped onto root. One source of truth
#     for what advisories we have accepted: the repo's composer.json.
#   - MediaWiki core's require-dev is dropped. We build with --no-dev, but
#     composer still *resolves* dev packages, and core pins
#     mediawiki-codesniffer to an exact version whose own floating dependency
#     has moved past it — an unsolvable conflict inside tools we never
#     install. Deleting require-dev from the build tree is the standard cure;
#     the repo's own composer.json is untouched.
#
# Keep this in step with the "Install Composer Dependencies" stage of the
# Jenkinsfile. When they drifted apart, the Jenkins build kept working and
# this one stopped, so nobody rebuilt the image for eight months and every
# local preview quietly rotted.
WORKDIR /var/www/html
COPY docker/prepare-composer.php /usr/local/bin/prepare-composer.php
RUN php /usr/local/bin/prepare-composer.php composer.json composer.local.json \
    && composer update --no-dev --optimize-autoloader --ignore-platform-reqs

# Install extensions not available via Composer (must match Jenkinsfile)
RUN git clone --depth 1 https://github.com/wikimedia/mediawiki-extensions-YouTube.git extensions/YouTube \
    && git clone --depth 1 https://github.com/wikimedia/mediawiki-extensions-MsUpload.git extensions/MsUpload \
    && git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-TimedMediaHandler.git extensions/TimedMediaHandler \
    && cd extensions/TimedMediaHandler && composer install --no-dev && cd ../.. \
    && git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-RSS.git extensions/RSS \
    && git clone --depth 1 --branch REL1_43 https://github.com/wikimedia/mediawiki-extensions-LinkSuggest.git extensions/LinkSuggest

# Copy custom extensions and create symlinks in extensions/
COPY extensions/ /var/www/html/custom-extensions/
RUN for ext in /var/www/html/custom-extensions/*/; do \
        name=$(basename "$ext"); \
        if [ "$name" != "*" ] && [ -d "$ext" ]; then \
            ln -sf "$ext" "/var/www/html/extensions/$name"; \
        fi; \
    done

# Copy custom assets (logo, etc.)
COPY assets/ /var/www/html/assets/

# Apache configuration - enable rewrite, headers and AllowOverride for .htaccess
RUN a2enmod rewrite headers
RUN sed -i '/<Directory \/var\/www\/>/,/<\/Directory>/ s/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf
RUN chown -R www-data:www-data /var/www/html

# PHP configuration for MediaWiki
RUN echo "memory_limit = 256M" > /usr/local/etc/php/conf.d/mediawiki.ini \
    && echo "upload_max_filesize = 100M" >> /usr/local/etc/php/conf.d/mediawiki.ini \
    && echo "post_max_size = 100M" >> /usr/local/etc/php/conf.d/mediawiki.ini

EXPOSE 80
