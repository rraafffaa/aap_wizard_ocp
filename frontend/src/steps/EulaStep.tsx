import React from 'react';
import { ExclamationTriangleIcon } from '@patternfly/react-icons';
import type { DeploymentConfig } from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

const EULA_TEXT = `RED HAT ANSIBLE AUTOMATION PLATFORM
END USER LICENSE AGREEMENT (EULA)

PLEASE READ THIS END USER LICENSE AGREEMENT CAREFULLY BEFORE USING SOFTWARE
FROM RED HAT. BY USING RED HAT SOFTWARE, YOU SIGNIFY YOUR ASSENT TO AND
ACCEPTANCE OF THIS END USER LICENSE AGREEMENT AND ACKNOWLEDGE YOU HAVE READ
AND UNDERSTAND THE TERMS. AN INDIVIDUAL ACTING ON BEHALF OF AN ENTITY
REPRESENTS THAT HE OR SHE HAS THE AUTHORITY TO ENTER INTO THIS END USER
LICENSE AGREEMENT ON BEHALF OF THAT ENTITY.

1. The Programs. Red Hat Ansible Automation Platform (the "Programs") 
provided under this Agreement include software developed by Red Hat and 
other open source software components. Most components of the Programs 
are governed under open source licenses, including the GNU General Public 
License v3 and the Apache License 2.0.

2. Intellectual Property Rights. The Programs and each of their components 
are owned by Red Hat and other licensors and are protected under copyright 
law and under other laws as applicable.

3. Usage. You are granted a non-exclusive, non-transferable license to use 
the Programs for the purposes of deploying and managing automation across 
your organization, subject to Red Hat's subscription terms.

4. Subscription Services. Red Hat's obligation to provide the Subscription 
Services is conditioned on you having a valid Subscription for each Unit 
that you deploy.

5. Limited Warranty. Except as specifically stated in this Agreement, the 
Programs and the components of the Programs are provided and licensed "as 
is" without warranty of any kind, expressed or implied.

6. Limitation of Remedies and Liability. To the maximum extent permitted 
under applicable law, Red Hat will not be liable to you for any 
incidental or consequential damages, including lost profits or lost 
savings arising out of the use or inability to use the Programs.

7. Export Control. You understand that the Programs may be subject to U.S. 
export control laws, including the U.S. Export Administration Act and its 
associated regulations. You agree not to export, re-export, or transfer 
the Programs contrary to U.S. or applicable law.

8. Third Party Programs. Red Hat may distribute third party software 
programs with the Programs that are not part of the Programs. Red Hat 
makes no representations or warranties with respect to these third party 
programs.

9. General. If any provision of this Agreement is held to be unenforceable, 
that shall not affect the enforceability of the remaining provisions.

Copyright (c) 2024-2026 Red Hat, Inc. All rights reserved.
"Red Hat" and "Ansible" are trademarks of Red Hat, Inc., registered in 
the U.S. and other countries.

For the full license text, visit:
https://www.redhat.com/en/about/agreements`;

export function EulaStep({ config, updateConfig }: Props) {
  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">License Agreement</h2>
      </div>

      <div className="aap-card aap-mb-lg">
        <pre className="aap-eula">
          {EULA_TEXT}
        </pre>
      </div>

      <div className={`aap-card ${config.eula_accepted ? 'aap-card--selected' : ''}`}>
        <label className="aap-checkbox">
          <input
            type="checkbox"
            checked={config.eula_accepted}
            onChange={(e) => updateConfig({ eula_accepted: e.target.checked })}
            aria-label="I have read and accept the Red Hat Ansible Automation Platform End User License Agreement"
          />
          <span>
            I accept the End User License Agreement
          </span>
        </label>
      </div>

      {!config.eula_accepted && (
        <div className="aap-alert aap-alert--warning aap-mt-md" role="alert">
          <span className="aap-alert__icon" aria-hidden="true">
            <ExclamationTriangleIcon />
          </span>
          <div className="aap-alert__content">
            <span className="aap-alert__title">Action required</span>
            <p>You must accept the license agreement to proceed.</p>
          </div>
        </div>
      )}
    </div>
  );
}
