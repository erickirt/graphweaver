import clsx from 'clsx';
import React, { useEffect, useRef } from 'react';

import styles from './styles.module.css';

export interface ModalProps {
	isOpen: boolean;
	onRequestClose?: () => void;
	className?: string;
	title?: string | React.ReactElement;
	modalContent?: React.ReactElement;
	footerContent?: React.ReactElement;
	hideCloseX?: boolean;
	fullScreen?: boolean;
	shouldCloseOnOverlayClick?: boolean;
	shouldCloseOnEsc?: boolean;
	overlay?: boolean;
}

export const Modal = ({
	isOpen,
	onRequestClose,
	className,
	title,
	modalContent,
	footerContent,
	hideCloseX = false,
	fullScreen,
	shouldCloseOnOverlayClick = false,
	shouldCloseOnEsc = false,
	overlay = true,
}: ModalProps) => {
	const modalRef = useRef<HTMLDivElement>(null);
	const overlayRef = useRef<HTMLDivElement>(null);

	function handleMouseDownEvent(event: DocumentEventMap['mousedown']) {
		// No ref or target to compare? Return with no action
		if (!modalRef?.current || !event.target) {
			return;
		}

		// Target of the click is the button,return with no action.
		// @todo check children as well?
		if (modalRef.current.contains(event.target as Node)) {
			return;
		}

		// If the overlay was clicked, close the modal
		if (shouldCloseOnOverlayClick && overlayRef.current?.contains(event.target as Node)) {
			onRequestClose?.();
		}
	}

	useEffect(() => {
		const handleEsc = (event: DocumentEventMap['keydown']) => {
			if (event.key === 'Escape' && shouldCloseOnEsc) {
				onRequestClose?.();
			}
		};
		// Register mousedown listeners to capture outside click
		document.addEventListener('mousedown', handleMouseDownEvent);
		document.addEventListener('keydown', handleEsc);
		return () => {
			document.removeEventListener('mousedown', handleMouseDownEvent);
			document.removeEventListener('keydown', handleEsc);
		};
	}, []);

	return (
		<>
			{isOpen && (
				<div
					ref={overlayRef}
					className={clsx(overlay ? styles.overlay : styles.noOverlay)}
					data-testid="modal-background"
				>
					<div
						ref={modalRef}
						className={clsx(className || [styles.wrapper, fullScreen && styles.fullScreen])}
					>
						<div className={styles.content} data-testid="modal-content">
							{title && (
								<div className={styles.headerWrapper}>
									<div className={styles.header}>
										<div className={styles.title}>{title}</div>
										{hideCloseX ? null : (
											<div className={styles.iconContainer} onClick={onRequestClose}>
												<div className={styles.closeIconWrapper}>
													<div className={styles.closeIconLeft}>
														<div className={styles.closeIconRight}></div>
													</div>
												</div>
											</div>
										)}
									</div>
								</div>
							)}
							{modalContent && <div className={styles.contentWrapper}>{modalContent}</div>}
							{footerContent && <div className={styles.footerWrapper}>{footerContent}</div>}
						</div>
					</div>
				</div>
			)}
		</>
	);
};
